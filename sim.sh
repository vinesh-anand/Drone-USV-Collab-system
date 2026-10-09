#!/usr/bin/env bash
set -Eeuo pipefail

# Drone-OS simulation launcher: one GNOME Terminal window per process.
# Terminal windows stay open after commands exit so errors remain visible.

if ! command -v gnome-terminal >/dev/null 2>&1; then
  echo "Error: gnome-terminal is not installed."
  echo "Install it with: sudo apt install gnome-terminal"
  exit 1
fi

for required in /opt/ros/noetic/setup.bash "$HOME/ardupilot" "$HOME/Drone-OS"; do
  if [[ ! -e "$required" ]]; then
    echo "Error: required path not found: $required"
    exit 1
  fi
done

launch_terminal() {
  local title="$1"
  local command="$2"
  gnome-terminal --title="$title" -- bash -lc "$command; status=\$?; echo; echo \"[$title] exited with status \$status\"; exec bash" >/dev/null 2>&1 &
}

ROS_SETUP='source /opt/ros/noetic/setup.bash'

echo "Starting Drone-OS simulation terminals..."

# 1. ROS master
launch_terminal "1 - ROS Core" "$ROS_SETUP; roscore"
sleep 3

# 2. ROSBridge
launch_terminal "2 - ROSBridge" "$ROS_SETUP; roslaunch rosbridge_server rosbridge_websocket.launch"
sleep 3

# 3. Drone ArduCopter SITL
launch_terminal "3 - Drone SITL" "$ROS_SETUP; cd \"$HOME/ardupilot\"; ./Tools/autotest/sim_vehicle.py -v ArduCopter -I 0 --custom-location=19.1685,73.0039,584,0 -m \"--out=udp:127.0.0.1:14550\""
sleep 5

# 4. Drone MAVROS
launch_terminal "4 - Drone MAVROS" "$ROS_SETUP; roslaunch mavros apm.launch fcu_url:=udp://:14550@127.0.0.1:14550 tgt_system:=1 tgt_component:=1 __ns:=/mavros_drone"
sleep 3

# 5. FASTY ArduRover SITL
launch_terminal "5 - FASTY SITL" "$ROS_SETUP; cd \"$HOME/ardupilot\"; ./Tools/autotest/sim_vehicle.py -v Rover -f rover -I 1 --sysid 2 --custom-location=19.1685,73.0039,584,0 -m \"--out=udp:127.0.0.1:14552\""
sleep 5

# 6. FASTY MAVROS
launch_terminal "6 - FASTY MAVROS" "$ROS_SETUP; roslaunch mavros apm.launch fcu_url:=udp://:14552@127.0.0.1:14552 tgt_system:=2 tgt_component:=1 __ns:=/mavros_fasty"
sleep 5

# 7. Dashboard
#launch_terminal "7 - Drone-OS Dashboard" "cd \"$HOME/Drone-OS\"; npm run dev"
#sleep 5

# 8. SROTA controller
launch_terminal "8 - SROTA Controller" "$ROS_SETUP; cd \"$HOME/Drone-OS/ros_ws\"; source devel/setup.bash; rosrun srota_control srota_control_node"

echo
echo "Launch commands sent to GNOME Terminal."
echo "Wait for SITL and MAVROS to initialize before operating the dashboard."
echo "The dashboard URL is printed in terminal 7 (often http://localhost:3000)."
