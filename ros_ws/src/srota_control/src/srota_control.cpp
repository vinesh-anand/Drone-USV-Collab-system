/*
 * Rover 2: exposes ROS services to (1) go to Rover 1's CURRENT location,
 * (2) return to Rover 2's own launch point, (3) CONTINUOUSLY FOLLOW Rover 1,
 * or (4) STOP whatever it is doing.
 *
 * C++ (roscpp) port of rover2_follow_rover1.py
 *
 * Services advertised (std_srvs/Trigger):
 *
 *   /srota/goto_drone     drive to wherever Rover1 is RIGHT NOW (one-shot)
 *   /srota/return_home    drive back to Rover2's launch point
 *   /srota/follow         keep tracking Rover1's live position until /srota/stop
 *   /srota/stop           abort the current drive/follow and HOLD in place
 *   /srota/status         report current mode/position/launch point, no movement
 *
 * Each movement service call BLOCKS until the drive finishes, is stopped, or
 * times out, then returns success/message. /srota/follow has no natural end:
 * it runs until /srota/stop is called (returns success=true in that case), or
 * until the optional ~follow_timeout_s expires, or Rover2 disarms / leaves GUIDED.
 *
 * Only one leg runs at a time -- calling a movement service while Rover2 is
 * already driving returns success=false with a "busy" message. /srota/stop is
 * the exception: it can always be called, and it interrupts the running leg.
 *
 * Launch point: recorded ONCE at node start, after waiting for a good GPS fix
 * (reported horizontal std-dev <= ~launch_max_std_m) and averaging N samples.
 *
 * Private parameters:
 *   ~rover1_ns          (default /mavros_drone/mavros)
 *   ~rover2_ns          (default /mavros_fasty/mavros)
 *   ~follow_standoff_m  (default 3.0)  Rover2 stays this far behind Rover1
 *   ~follow_timeout_s   (default 0.0)  0 = follow until /srota/stop
 *   ~launch_max_std_m   (default 1.5)  max GPS std-dev accepted for launch point
 *
 * Run:
 *   rosrun srota_control waypoint_to_srota
 *   rosrun srota_control waypoint_to_srota _rover1_ns:=/mavros_drone/mavros \
 *                                          _rover2_ns:=/mavros_fasty/mavros \
 *                                          _follow_standoff_m:=5.0
 *
 * Call:
 *   rosservice call /srota/goto_drone
 *   rosservice call /srota/return_home
 *   rosservice call /srota/follow
 *   rosservice call /srota/stop
 *   rosservice call /srota/status
 */

#include <ros/ros.h>

#include <sensor_msgs/NavSatFix.h>
#include <std_srvs/Trigger.h>
#include <mavros_msgs/CommandBool.h>
#include <mavros_msgs/GlobalPositionTarget.h>
#include <mavros_msgs/SetMode.h>
#include <mavros_msgs/State.h>
#include <mavros_msgs/StatusText.h>

#include <atomic>
#include <chrono>
#include <cmath>
#include <condition_variable>
#include <cstdarg>
#include <cstdio>
#include <functional>
#include <limits>
#include <mutex>
#include <string>

namespace
{

// ============================================================
// CONFIGURATION
// ============================================================

constexpr double ARRIVE_RADIUS_M = 2.0;
constexpr double TIMEOUT_S       = 300.0;
constexpr int    ARM_RETRIES     = 10;
constexpr double RATE_HZ         = 10.0;
constexpr double STOP_WAIT_S     = 10.0;   // how long /stop waits for the leg to wind down
constexpr double EARTH_RADIUS_M  = 6371000.0;
constexpr int    SPINNER_THREADS = 4;      // must be > 1 so /stop can run during a drive

// Launch point recording
constexpr int    LAUNCH_SAMPLES        = 30;    // ~3 s at 10 Hz
constexpr double LAUNCH_FIX_TIMEOUT_S  = 60.0;  // after this, accept valid fixes even if covariance is unknown/poor

const std::string END_MODE = "HOLD";

using GPT = mavros_msgs::GlobalPositionTarget;

const uint16_t POSITION_ONLY_MASK = static_cast<uint16_t>(
    GPT::IGNORE_VX | GPT::IGNORE_VY | GPT::IGNORE_VZ |
    GPT::IGNORE_AFX | GPT::IGNORE_AFY | GPT::IGNORE_AFZ |
    GPT::IGNORE_YAW | GPT::IGNORE_YAW_RATE);

const double NaN = std::numeric_limits<double>::quiet_NaN();

// ============================================================
// HELPERS
// ============================================================

std::string format(const char* fmt, ...) __attribute__((format(printf, 1, 2)));

std::string format(const char* fmt, ...)
{
  char buf[768];
  va_list ap;
  va_start(ap, fmt);
  vsnprintf(buf, sizeof(buf), fmt, ap);
  va_end(ap);
  return std::string(buf);
}

bool validFix(const sensor_msgs::NavSatFix& m)
{
  return m.status.status >= 0 && m.latitude != 0.0 && m.longitude != 0.0;
}

// Horizontal 1-sigma from the NavSatFix covariance (variance of first axis), or -1 if unknown.
double fixStdM(const sensor_msgs::NavSatFix& m)
{
  if (m.position_covariance_type == sensor_msgs::NavSatFix::COVARIANCE_TYPE_UNKNOWN)
    return -1.0;
  const double var = m.position_covariance[0];
  return var >= 0.0 ? std::sqrt(var) : -1.0;
}

double horizontalDistanceM(double lat1, double lon1, double lat2, double lon2)
{
  const double p1 = lat1 * M_PI / 180.0;
  const double p2 = lat2 * M_PI / 180.0;
  const double dphi = p2 - p1;
  const double dlmb = (lon2 - lon1) * M_PI / 180.0;
  const double a = std::sin(dphi / 2) * std::sin(dphi / 2) +
                   std::cos(p1) * std::cos(p2) * std::sin(dlmb / 2) * std::sin(dlmb / 2);
  return 2.0 * EARTH_RADIUS_M * std::asin(std::sqrt(a));
}

// Point that lies `meters` from (lat, lon) on the straight line toward (tlat, tlon).
// Flat-earth approximation -- accurate for the short distances used here.
// Used by follow mode to aim at a spot `standoff` metres behind Rover1
// (start = Rover1, toward = Rover2).
void pointToward(double lat, double lon, double tlat, double tlon, double meters,
                 double& out_lat, double& out_lon)
{
  const double deg2rad = M_PI / 180.0;
  const double coslat = std::cos(lat * deg2rad);
  const double dN = (tlat - lat) * deg2rad * EARTH_RADIUS_M;
  const double dE = (tlon - lon) * deg2rad * EARTH_RADIUS_M * coslat;
  const double d = std::sqrt(dN * dN + dE * dE);

  if (d < 1e-6 || coslat < 1e-9)
  {
    out_lat = lat;
    out_lon = lon;
    return;
  }
  const double f = meters / d;
  out_lat = lat + (dN * f / EARTH_RADIUS_M) / deg2rad;
  out_lon = lon + (dE * f / (EARTH_RADIUS_M * coslat)) / deg2rad;
}

GPT makeSetpoint(double lat, double lon)
{
  GPT sp;
  sp.coordinate_frame = GPT::FRAME_GLOBAL_REL_ALT;
  sp.type_mask = POSITION_ONLY_MASK;
  sp.latitude = lat;
  sp.longitude = lon;
  sp.altitude = 0.0;
  return sp;
}

enum class Reason { Reached, Stopped, Timeout, Aborted };

struct DriveResult
{
  Reason reason;
  double dist;
};

// ============================================================
// NODE
// ============================================================

class SrotaNode
{
public:
  SrotaNode() : pnh_("~") {}

  int run()
  {
    pnh_.param<std::string>("rover1_ns", rover1_ns_, "/mavros_drone/mavros");
    pnh_.param<std::string>("rover2_ns", rover2_ns_, "/mavros_fasty/mavros");
    pnh_.param<double>("follow_standoff_m", follow_standoff_m_, 3.0);
    pnh_.param<double>("follow_timeout_s", follow_timeout_s_, 0.0);
    pnh_.param<double>("launch_max_std_m", launch_max_std_m_, 1.5);

    ROS_INFO("Rover2 (%s) service node -- target is Rover1 (%s)",
             rover2_ns_.c_str(), rover1_ns_.c_str());
    ROS_INFO("Follow mode: standoff=%.1f m, timeout=%s",
             follow_standoff_m_,
             follow_timeout_s_ > 0.0 ? format("%.0f s", follow_timeout_s_).c_str() : "none");

    r1_gps_sub_ = nh_.subscribe(rover1_ns_ + "/global_position/global", 1,
                                &SrotaNode::r1GpsCb, this);
    r2_state_sub_ = nh_.subscribe(rover2_ns_ + "/state", 1,
                                  &SrotaNode::r2StateCb, this);
    r2_gps_sub_ = nh_.subscribe(rover2_ns_ + "/global_position/global", 1,
                                &SrotaNode::r2GpsCb, this);
    statustext_sub_ = nh_.subscribe(rover2_ns_ + "/statustext/recv", 10,
                                    &SrotaNode::statustextCb, this);

    sp_pub_ = nh_.advertise<GPT>(rover2_ns_ + "/setpoint_raw/global", 10);

    arm_srv_ = nh_.serviceClient<mavros_msgs::CommandBool>(rover2_ns_ + "/cmd/arming");
    mode_srv_ = nh_.serviceClient<mavros_msgs::SetMode>(rover2_ns_ + "/set_mode");

    // Multi-threaded spinner: service callbacks run in parallel, which is what
    // lets /srota/stop interrupt a blocking /srota/goto_drone or /srota/follow call.
    ros::AsyncSpinner spinner(SPINNER_THREADS);
    spinner.start();

    if (!arm_srv_.waitForExistence(ros::Duration(10.0)) ||
        !mode_srv_.waitForExistence(ros::Duration(10.0)))
    {
      ROS_ERROR("Rover2 MAVROS services not available (check namespace).");
      return 1;
    }

    ros::Rate rate(RATE_HZ);

    // ---- wait for Rover2 FCU + both GPS ----
    ROS_INFO("Waiting for Srota FCU...");
    while (ros::ok() && !getState().connected)
      rate.sleep();

    ROS_INFO("Waiting for Srota GPS and Drone GPS...");
    while (ros::ok() && !(r2Valid() && r1Valid()))
    {
      ROS_INFO_THROTTLE(2, "Srota gps=%s | Drone gps=%s",
                        r2Valid() ? "true" : "false", r1Valid() ? "true" : "false");
      rate.sleep();
    }
    if (!ros::ok())
      return 0;

    // ---- record Rover2's launch point ONCE, before it ever moves ----
    // Wait for a good fix (low reported std-dev), then average N samples.
    // Averaging restarts if the fix degrades mid-collection.
    {
      double sum_lat = 0.0, sum_lon = 0.0;
      int n = 0;
      const ros::Time t_start = ros::Time::now();
      bool relaxed_warned = false;

      ROS_INFO("Waiting for a good Srota fix to record launch point (std <= %.2f m)...",
               launch_max_std_m_);

      while (ros::ok() && n < LAUNCH_SAMPLES)
      {
        const sensor_msgs::NavSatFix g = getR2Gps();
        const double std_m = fixStdM(g);
        const bool relaxed = (ros::Time::now() - t_start).toSec() > LAUNCH_FIX_TIMEOUT_S;

        if (relaxed && !relaxed_warned)
        {
          ROS_WARN("No fix with std <= %.2f m after %.0f s; accepting any valid fix for launch point.",
                   launch_max_std_m_, LAUNCH_FIX_TIMEOUT_S);
          relaxed_warned = true;
        }

        const bool accuracy_ok = (std_m >= 0.0 && std_m <= launch_max_std_m_);
        const bool good = validFix(g) && (accuracy_ok || relaxed);

        if (good)
        {
          sum_lat += g.latitude;
          sum_lon += g.longitude;
          ++n;
        }
        else
        {
          n = 0;
          sum_lat = 0.0;
          sum_lon = 0.0;
          ROS_INFO_THROTTLE(2, "Srota fix not good enough yet (std=%.2f m, status=%d)",
                            std_m, static_cast<int>(g.status.status));
        }
        rate.sleep();
      }
      if (!ros::ok() || n == 0)
        return 0;

      launch_lat_ = sum_lat / n;
      launch_lon_ = sum_lon / n;
    }
    ROS_INFO("SROTA LAUNCH POINT  lat=%.8f  lon=%.8f  (averaged over %d samples)",
             launch_lat_, launch_lon_, LAUNCH_SAMPLES);

    // ---- GUIDED + arm (once, kept for the whole session) ----
    if (!setModeAndConfirm("GUIDED"))
    {
      ROS_ERROR("Could not enter GUIDED.");
      return 1;
    }

    bool armed = false;
    for (int attempt = 1; attempt <= ARM_RETRIES; ++attempt)
    {
      if (!ros::ok())
        return 0;
      ROS_INFO("Arming attempt %d/%d...", attempt, ARM_RETRIES);

      mavros_msgs::CommandBool arm;
      arm.request.value = true;
      {
        std::lock_guard<std::mutex> lk(arm_call_mtx_);
        if (!arm_srv_.call(arm))
          ROS_ERROR("Arm service failed.");
      }

      ros::Duration(1.5).sleep();
      if (getState().armed)
      {
        armed = true;
        break;
      }
      ros::Duration(3.0).sleep();
    }

    if (!armed)
    {
      ROS_ERROR("SROTA ARM FAILED.");
      return 1;
    }

    setModeAndConfirm(END_MODE);
    ROS_INFO("SROTA ARMED and ready, holding in %s.", END_MODE.c_str());

    // ---- advertise services ----
    ros::ServiceServer goto_srv =
        nh_.advertiseService("/srota/goto_drone", &SrotaNode::handleGotoDrone, this);
    ros::ServiceServer home_srv =
        nh_.advertiseService("/srota/return_home", &SrotaNode::handleReturnHome, this);
    ros::ServiceServer follow_srv =
        nh_.advertiseService("/srota/follow", &SrotaNode::handleFollow, this);
    ros::ServiceServer stop_srv =
        nh_.advertiseService("/srota/stop", &SrotaNode::handleStop, this);
    ros::ServiceServer status_srv =
        nh_.advertiseService("/srota/status", &SrotaNode::handleStatus, this);

    ROS_INFO("==========================================");
    ROS_INFO("Services ready:");
    ROS_INFO("  rosservice call /srota/goto_drone");
    ROS_INFO("  rosservice call /srota/return_home");
    ROS_INFO("  rosservice call /srota/follow");
    ROS_INFO("  rosservice call /srota/stop");
    ROS_INFO("  rosservice call /srota/status");
    ROS_INFO("==========================================");

    ros::waitForShutdown();
    return 0;
  }

private:
  // ----------------------------------------------------------
  // Subscriber callbacks (run on spinner threads -> lock data_mtx_)
  // ----------------------------------------------------------

  void r2StateCb(const mavros_msgs::State::ConstPtr& msg)
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    r2_state_ = *msg;
  }

  void r1GpsCb(const sensor_msgs::NavSatFix::ConstPtr& msg)
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    r1_gps_ = *msg;
    if (validFix(*msg))
      r1_valid_ = true;
  }

  void r2GpsCb(const sensor_msgs::NavSatFix::ConstPtr& msg)
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    r2_gps_ = *msg;
    if (validFix(*msg))
      r2_valid_ = true;
  }

  void statustextCb(const mavros_msgs::StatusText::ConstPtr& msg)
  {
    ROS_WARN("SROTA ARDUPILOT: severity=%d | %s", msg->severity, msg->text.c_str());
  }

  // ----------------------------------------------------------
  // Thread-safe snapshots of shared data
  // ----------------------------------------------------------

  mavros_msgs::State getState()
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    return r2_state_;
  }

  sensor_msgs::NavSatFix getR1Gps()
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    return r1_gps_;
  }

  sensor_msgs::NavSatFix getR2Gps()
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    return r2_gps_;
  }

  bool r1Valid()
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    return r1_valid_;
  }

  bool r2Valid()
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    return r2_valid_;
  }

  std::string getTask()
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    return current_task_;
  }

  void setTask(const std::string& t)
  {
    std::lock_guard<std::mutex> lk(data_mtx_);
    current_task_ = t;
  }

  // ----------------------------------------------------------
  // Vehicle helpers
  // ----------------------------------------------------------

  // Send a mode change request (no waiting). Returns true if the call went through.
  bool sendMode(const std::string& mode)
  {
    mavros_msgs::SetMode srv;
    srv.request.base_mode = 0;
    srv.request.custom_mode = mode;

    std::lock_guard<std::mutex> lk(mode_call_mtx_);
    if (!mode_srv_.call(srv))
    {
      ROS_ERROR("set_mode(%s) failed", mode.c_str());
      return false;
    }
    return true;
  }

  bool setModeAndConfirm(const std::string& mode, double timeout = 5.0)
  {
    if (!sendMode(mode))
      return false;

    // Local Rate: ros::Rate is not thread-safe, so never share one between threads.
    ros::Rate rate(RATE_HZ);
    const ros::Time t0 = ros::Time::now();
    while (ros::ok() && (ros::Time::now() - t0).toSec() < timeout)
    {
      if (getState().mode == mode)
        return true;
      rate.sleep();
    }
    ROS_WARN("Mode %s not confirmed (current: %s)", mode.c_str(), getState().mode.c_str());
    return false;
  }

  // Stream a position setpoint to (lat, lon) until arrival, stop, or timeout.
  DriveResult driveTo(double lat, double lon, const std::string& label)
  {
    GPT sp = makeSetpoint(lat, lon);
    const ros::Time t0 = ros::Time::now();
    ros::Rate rate(RATE_HZ);
    DriveResult res{Reason::Aborted, NaN};

    while (ros::ok())
    {
      const sensor_msgs::NavSatFix g = getR2Gps();
      const mavros_msgs::State st = getState();
      res.dist = horizontalDistanceM(g.latitude, g.longitude, lat, lon);

      // stop request has top priority
      if (stop_event_.load())
      {
        ROS_WARN("%s STOPPED by service call.", label.c_str());
        res.reason = Reason::Stopped;
        break;
      }

      sp.header.stamp = ros::Time::now();
      sp_pub_.publish(sp);

      ROS_INFO_THROTTLE(2, "%s | dist=%.1f m | mode=%s | armed=%s",
                        label.c_str(), res.dist, st.mode.c_str(), st.armed ? "true" : "false");

      if (!st.armed || st.mode != "GUIDED")
      {
        ROS_ERROR("Srota disarmed or left GUIDED during %s. Aborting.", label.c_str());
        res.reason = Reason::Aborted;
        break;
      }

      if (res.dist <= ARRIVE_RADIUS_M)
      {
        ROS_INFO("%s REACHED (%.1f m).", label.c_str(), res.dist);
        res.reason = Reason::Reached;
        break;
      }

      if ((ros::Time::now() - t0).toSec() > TIMEOUT_S)
      {
        ROS_WARN("%s timed out after %.0f s.", label.c_str(), TIMEOUT_S);
        res.reason = Reason::Timeout;
        break;
      }

      rate.sleep();
    }
    return res;
  }

  // FOLLOW MODE: continuously re-read Rover1's live position and stream a setpoint
  // `standoff_m` behind it. There is no "arrival" -- the loop only ends on /stop,
  // the optional timeout (timeout_s > 0), or Rover2 disarming / leaving GUIDED.
  //   - Rover1 within standoff  -> setpoint = Rover2's own position (sit still)
  //   - Rover1 farther away     -> setpoint = point `standoff_m` short of Rover1
  //   - Rover1 fix lost         -> setpoint = Rover2's own position (sit still)
  DriveResult followRover1(const std::string& label, double standoff_m, double timeout_s)
  {
    const ros::Time t0 = ros::Time::now();
    ros::Rate rate(RATE_HZ);
    DriveResult res{Reason::Aborted, NaN};

    while (ros::ok())
    {
      const sensor_msgs::NavSatFix r1 = getR1Gps();
      const sensor_msgs::NavSatFix r2 = getR2Gps();
      const mavros_msgs::State st = getState();

      // stop request has top priority
      if (stop_event_.load())
      {
        ROS_WARN("%s STOPPED by service call.", label.c_str());
        res.reason = Reason::Stopped;
        break;
      }

      if (!st.armed || st.mode != "GUIDED")
      {
        ROS_ERROR("Srota disarmed or left GUIDED during %s. Aborting.", label.c_str());
        res.reason = Reason::Aborted;
        break;
      }

      if (timeout_s > 0.0 && (ros::Time::now() - t0).toSec() > timeout_s)
      {
        ROS_WARN("%s timed out after %.0f s.", label.c_str(), timeout_s);
        res.reason = Reason::Timeout;
        break;
      }

      double tgt_lat = r2.latitude;   // default: hold where we are
      double tgt_lon = r2.longitude;
      const char* state_txt = "HOLDING (no Rover1 fix)";

      if (validFix(r1))
      {
        res.dist = horizontalDistanceM(r2.latitude, r2.longitude, r1.latitude, r1.longitude);
        if (res.dist > standoff_m)
        {
          // aim at a point `standoff_m` from Rover1, on the line toward Rover2
          pointToward(r1.latitude, r1.longitude, r2.latitude, r2.longitude, standoff_m,
                      tgt_lat, tgt_lon);
          state_txt = "CHASING";
        }
        else
        {
          state_txt = "IN RANGE";
        }
      }
      else
      {
        ROS_WARN_THROTTLE(2, "%s: Rover1 GPS fix invalid, holding position.", label.c_str());
      }

      GPT sp = makeSetpoint(tgt_lat, tgt_lon);
      sp.header.stamp = ros::Time::now();
      sp_pub_.publish(sp);

      ROS_INFO_THROTTLE(2, "%s | %s | dist_to_rover1=%.1f m (standoff %.1f m)",
                        label.c_str(), state_txt, res.dist, standoff_m);

      rate.sleep();
    }
    return res;
  }

  // Shared logic for all movement services: busy-check, run the given drive
  // function, hold, report. `stop_is_success` is true for open-ended modes
  // (follow) where being stopped by /srota/stop is the expected outcome.
  bool runLeg(const std::string& label, const std::string& task_name, std::string& msg,
              const std::function<DriveResult()>& drive, bool stop_is_success = false)
  {
    {
      std::lock_guard<std::mutex> lk(busy_mtx_);
      if (busy_)
      {
        msg = "Busy: currently doing '" + getTask() +
              "'. Call /srota/stop first, or wait for it to finish.";
        ROS_WARN("%s", msg.c_str());
        return false;
      }
      stop_event_ = false;   // ignore any stale stop from before this leg
      busy_ = true;
    }
    setTask(task_name);

    bool ok = false;
    if (!setModeAndConfirm("GUIDED"))
    {
      msg = "Could not enter GUIDED mode.";
    }
    else
    {
      const DriveResult r = drive();
      setModeAndConfirm(END_MODE);

      switch (r.reason)
      {
        case Reason::Reached:
          ok = true;
          msg = format("%s: reached target (%.1f m away), now in %s.",
                       label.c_str(), r.dist, END_MODE.c_str());
          break;
        case Reason::Stopped:
          ok = stop_is_success;
          msg = format("%s: STOPPED by service call (%.1f m from target), now in %s.",
                       label.c_str(), r.dist, END_MODE.c_str());
          break;
        case Reason::Timeout:
          msg = format("%s: TIMED OUT (%.1f m from target), now in %s.",
                       label.c_str(), r.dist, END_MODE.c_str());
          break;
        case Reason::Aborted:
        default:
          msg = format("%s: ABORTED (%.1f m from target), now in %s.",
                       label.c_str(), r.dist, END_MODE.c_str());
          break;
      }
    }

    setTask("idle");
    {
      std::lock_guard<std::mutex> lk(busy_mtx_);
      busy_ = false;
    }
    busy_cv_.notify_all();   // wakes a waiting /srota/stop
    return ok;
  }

  // ----------------------------------------------------------
  // Service callbacks (always return true: the service call itself worked;
  // the outcome is reported in res.success / res.message)
  // ----------------------------------------------------------

  bool handleGotoDrone(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& res)
  {
    if (!r1Valid())
    {
      res.success = false;
      res.message = "No GPS fix from Rover1 yet.";
      return true;
    }

    // fresh snapshot of Rover1's CURRENT position, taken right now
    const sensor_msgs::NavSatFix g = getR1Gps();
    ROS_INFO("Service call: goto_drone -> lat=%.8f lon=%.8f", g.latitude, g.longitude);

    const double lat = g.latitude, lon = g.longitude;
    std::string msg;
    res.success = runLeg("TO_ROVER1", "goto_drone", msg,
                         [this, lat, lon]() { return driveTo(lat, lon, "TO_ROVER1"); });
    res.message = msg;
    return true;
  }

  bool handleReturnHome(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& res)
  {
    ROS_INFO("Service call: return_home -> lat=%.8f lon=%.8f", launch_lat_, launch_lon_);

    std::string msg;
    res.success = runLeg("RETURN_HOME", "return_home", msg,
                         [this]() { return driveTo(launch_lat_, launch_lon_, "RETURN_HOME"); });
    res.message = msg;
    return true;
  }

  // Follow Rover1 continuously until /srota/stop (blocks; call /srota/stop from
  // another terminal to end it).
  bool handleFollow(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& res)
  {
    if (!r1Valid())
    {
      res.success = false;
      res.message = "No GPS fix from Rover1 yet.";
      return true;
    }

    ROS_INFO("Service call: follow (standoff=%.1f m). Call /srota/stop to end.",
             follow_standoff_m_);

    const double standoff = follow_standoff_m_;
    const double timeout = follow_timeout_s_;
    std::string msg;
    res.success = runLeg("FOLLOW_Drone", "follow", msg,
                         [this, standoff, timeout]() {
                           return followRover1("FOLLOW_Drone", standoff, timeout);
                         },
                         /*stop_is_success=*/true);
    res.message = msg;
    return true;
  }

  // Abort the running leg (if any) and make sure Rover2 ends up in HOLD.
  bool handleStop(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& res)
  {
    std::unique_lock<std::mutex> lk(busy_mtx_);

    if (busy_)
    {
      const std::string task = getTask();
      ROS_WARN("Service call: STOP (interrupting '%s')", task.c_str());
      stop_event_ = true;

      // Wait for the leg to notice the flag, switch to HOLD and clear busy_.
      const bool finished = busy_cv_.wait_for(
          lk, std::chrono::duration<double>(STOP_WAIT_S), [this] { return !busy_; });
      lk.unlock();

      if (finished)
      {
        res.success = true;
        res.message = format("Stopped '%s'. Rover2 is in %s (mode=%s).",
                             task.c_str(), END_MODE.c_str(), getState().mode.c_str());
      }
      else
      {
        res.success = false;
        res.message = format("Stop requested for '%s' but it hasn't finished winding down after %.0f s.",
                             task.c_str(), STOP_WAIT_S);
      }
      return true;
    }
    lk.unlock();

    // Nothing running: just make sure we're holding.
    ROS_INFO("Service call: STOP (nothing running, commanding %s)", END_MODE.c_str());
    if (!sendMode(END_MODE))
    {
      res.success = false;
      res.message = format("Idle, but set_mode(%s) failed.", END_MODE.c_str());
      return true;
    }
    res.success = true;
    res.message = format("Nothing was running. Commanded %s.", END_MODE.c_str());
    return true;
  }

  bool handleStatus(std_srvs::Trigger::Request&, std_srvs::Trigger::Response& res)
  {
    const mavros_msgs::State st = getState();
    const sensor_msgs::NavSatFix g1 = getR1Gps();
    const sensor_msgs::NavSatFix g2 = getR2Gps();

    const double dist_to_r1 =
        r1Valid() ? horizontalDistanceM(g2.latitude, g2.longitude, g1.latitude, g1.longitude)
                  : NaN;
    const double dist_to_launch =
        horizontalDistanceM(g2.latitude, g2.longitude, launch_lat_, launch_lon_);

    res.success = true;
    res.message = format(
        "task=%s | mode=%s | armed=%s | rover2=(%.8f, %.8f) | rover1=(%.8f, %.8f) | "
        "launch=(%.8f, %.8f) | dist_to_rover1=%.1f m | dist_to_launch=%.1f m",
        getTask().c_str(), st.mode.c_str(), st.armed ? "True" : "False",
        g2.latitude, g2.longitude, g1.latitude, g1.longitude,
        launch_lat_, launch_lon_, dist_to_r1, dist_to_launch);
    return true;
  }

  // ----------------------------------------------------------
  // Members
  // ----------------------------------------------------------

  ros::NodeHandle nh_;
  ros::NodeHandle pnh_;

  std::string rover1_ns_;
  std::string rover2_ns_;

  // settings: written once in run(), read-only afterwards
  double follow_standoff_m_ = 3.0;
  double follow_timeout_s_ = 0.0;
  double launch_max_std_m_ = 1.5;

  ros::Subscriber r1_gps_sub_, r2_state_sub_, r2_gps_sub_, statustext_sub_;
  ros::Publisher sp_pub_;
  ros::ServiceClient arm_srv_, mode_srv_;

  // shared sensor/vehicle data (guarded by data_mtx_)
  std::mutex data_mtx_;
  mavros_msgs::State r2_state_;
  sensor_msgs::NavSatFix r1_gps_, r2_gps_;
  bool r1_valid_ = false;
  bool r2_valid_ = false;
  std::string current_task_ = "idle";

  // launch point: written once in run() before services are advertised, read-only afterwards
  double launch_lat_ = 0.0;
  double launch_lon_ = 0.0;

  // one-leg-at-a-time control
  std::mutex busy_mtx_;
  std::condition_variable busy_cv_;
  bool busy_ = false;                    // guarded by busy_mtx_
  std::atomic<bool> stop_event_{false};  // set by /stop, polled by driveTo()/followRover1()

  // serialize calls on the shared service clients
  std::mutex mode_call_mtx_;
  std::mutex arm_call_mtx_;
};

}  // namespace

// ============================================================
// MAIN
// ============================================================

int main(int argc, char** argv)
{
  ros::init(argc, argv, "srota_control_node");
  SrotaNode node;
  return node.run();
}
