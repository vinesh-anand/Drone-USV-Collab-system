#!/usr/bin/env node

/**
 * Drone-OS Ground Control Station startup manager.
 *
 * Starts the ROS/MAVROS/SROTA stack and the camera/AI service.
 * After the runtime stack is initialized, it starts the Electron dashboard
 * using:
 *
 *   npm run electron:dev
 *
 * Simulation architecture:
 *
 *   Drone SITL  -> Drone MAVProxy  -> UDP 14550 -> Drone MAVROS
 *   FASTY SITL  -> FASTY MAVProxy  -> UDP 14552 -> FASTY MAVROS
 *
 * SITL is started with --no-mavproxy, and MAVProxy runs as its own service so
 * its output is captured in a dedicated log.
 *
 * Current mode:
 *   simulation (default)
 *
 * Run:
 *   npm run start:gcs
 *
 * Stop everything started by this script with Ctrl+C
 * or by closing the Electron application.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream } from "node:fs";
import { createConnection } from "node:net";
import { homedir } from "node:os";
import { join } from "node:path";

const HOME = homedir();
const PROJECT_DIR =
  process.env.DRONE_OS_HOME || join(HOME, "Drone-OS");

const ROS_SETUP = "/opt/ros/noetic/setup.bash";
const ARDUPILOT_DIR = join(HOME, "ardupilot");
const ROS_WS = join(PROJECT_DIR, "ros_ws");
const LOG_DIR = join(PROJECT_DIR, "logs", "startup");

const MODE = (
  process.env.DRONE_OS_MODE || "simulation"
).toLowerCase();

const CAMERA_ENABLED =
  (process.env.DRONE_OS_CAMERA ?? "1") !== "0";

// MAVProxy is installed by pip --user.
const USER_BIN = join(HOME, ".local", "bin");
const MAVPROXY = join(USER_BIN, "mavproxy.py");

// SITL TCP ports.
const DRONE_SITL_PORT = 5760;
const FASTY_SITL_PORT = 5770;

// Electron dashboard command.
const ELECTRON_COMMAND = "npm";
const ELECTRON_ARGS = ["run", "electron:dev"];

/*
 * Basic validation
 */

if (!existsSync(ROS_SETUP)) {
  console.error(
    `Drone-OS startup error: ROS setup not found: ${ROS_SETUP}`,
  );
  process.exit(1);
}

if (!existsSync(PROJECT_DIR)) {
  console.error(
    `Drone-OS startup error: project directory not found: ${PROJECT_DIR}`,
  );
  process.exit(1);
}

if (!existsSync(ARDUPILOT_DIR) && MODE === "simulation") {
  console.error(
    `Drone-OS startup error: ArduPilot directory not found: ${ARDUPILOT_DIR}`,
  );
  process.exit(1);
}

if (!existsSync(MAVPROXY)) {
  console.error(
    `Drone-OS startup error: MAVProxy executable not found: ${MAVPROXY}`,
  );
  process.exit(1);
}

mkdirSync(LOG_DIR, { recursive: true });

const children = new Map();

let shuttingDown = false;

/*
 * Logging
 */

function timestamp() {
  return new Date().toISOString();
}

function log(message) {
  console.log(`[${timestamp()}] ${message}`);
}

function logFile(name) {
  return join(LOG_DIR, `${name}.log`);
}

/*
 * Environment for child processes.
 *
 * Electron can set ELECTRON_RUN_AS_NODE when Node code is launched through
 * Electron. Do not leak that variable into ROS/Python/MAVProxy processes.
 */

function childEnv() {
  const env = {
    ...process.env,
  };

  delete env.ELECTRON_RUN_AS_NODE;

  return env;
}

/*
 * Start a service.
 */

function startService(
  name,
  command,
  args = [],
  options = {},
) {
  const logPath = logFile(name);

  const out = createWriteStream(logPath, {
    flags: "a",
  });

  const child = spawn(command, args, {
    cwd: options.cwd || PROJECT_DIR,

    env: childEnv(),

    /*
     * Keep stdin as a pipe instead of /dev/null.
     * Some SITL/MAVProxy processes exit when stdin immediately reaches EOF.
     */
    stdio: ["pipe", "pipe", "pipe"],

    /*
     * Own process group so the complete process tree can be terminated.
     */
    detached: true,
  });

  child.stdout.pipe(out);
  child.stderr.pipe(out);

  children.set(name, child);

  child.on("spawn", () => {
    log(
      `${name}: started (log: ${logPath})`,
    );
  });

  child.on("error", (error) => {
    log(
      `${name}: failed to start: ${error.message}`,
    );
  });

  child.on("exit", (code, signal) => {
    children.delete(name);

    out.end();

    if (!shuttingDown) {
      log(
        `${name}: exited (code=${code}, signal=${signal})`,
      );
    }
  });

  return child;
}

/*
 * Start a service through bash with ROS environment loaded.
 */

function bashService(
  name,
  shellCommand,
  options = {},
) {
  const commandWithPath = [
    `source "${ROS_SETUP}"`,
    `export PATH="${USER_BIN}:$PATH"`,
    shellCommand,
  ].join(" && ");

  return startService(
    name,
    "bash",
    ["-lc", commandWithPath],
    options,
  );
}

/*
 * Kill an entire process group.
 */

function killTree(child, signal) {
  if (!child || !child.pid) {
    return;
  }

  try {
    /*
     * Negative PID means the complete process group.
     */
    process.kill(-child.pid, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      // Process may already have exited.
    }
  }
}

/*
 * Delay helper.
 */

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

/*
 * Wait until a TCP port becomes available.
 */

function waitForPort(
  port,
  timeoutMs = 30000,
  host = "127.0.0.1",
) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    const attempt = () => {
      const socket = createConnection(
        {
          host,
          port,
        },
        () => {
          socket.destroy();
          resolve(true);
        },
      );

      socket.on("error", () => {
        socket.destroy();

        if (Date.now() > deadline) {
          resolve(false);
        } else {
          setTimeout(attempt, 500);
        }
      });
    };

    attempt();
  });
}

/*
 * Wait for a named service.
 */

async function waitForService(
  label,
  port,
  timeoutMs,
) {
  log(
    `Waiting for ${label} on port ${port}...`,
  );

  const ok = await waitForPort(
    port,
    timeoutMs,
  );

  if (ok) {
    log(`${label} is ready.`);
  } else {
    log(
      `${label} did not open port ${port} in time; continuing anyway.`,
    );
  }

  return ok;
}

/*
 * Shutdown everything started by Drone-OS.
 */

async function shutdown(
  reason = "shutdown",
) {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;

  log(
    `Drone-OS shutdown requested: ${reason}`,
  );

  /*
   * Stop in reverse startup order.
   */
  for (
    const [name, child] of [
      ...children.entries(),
    ].reverse()
  ) {
    if (
      !child ||
      child.exitCode !== null
    ) {
      continue;
    }

    log(`${name}: stopping...`);

    killTree(
      child,
      "SIGTERM",
    );
  }

  /*
   * Give processes time to shut down cleanly.
   */
  await wait(3000);

  /*
   * Force-kill anything still alive.
   */
  for (
    const [name, child] of [
      ...children.entries(),
    ].reverse()
  ) {
    if (
      !child ||
      child.exitCode !== null
    ) {
      continue;
    }

    log(
      `${name}: force stopping...`,
    );

    killTree(
      child,
      "SIGKILL",
    );
  }

  children.clear();

  log(
    "Drone-OS shutdown complete.",
  );
}

/*
 * Start the Electron dashboard.
 */

function startElectronDashboard() {
  log(
    "11_dashboard: starting Electron dashboard...",
  );

  return startService(
    "11_dashboard",
    ELECTRON_COMMAND,
    ELECTRON_ARGS,
    {
      cwd: PROJECT_DIR,
    },
  );
}

/*
 * Main startup sequence.
 */

async function main() {
  if (MODE !== "simulation") {
    console.error(
      `Unsupported DRONE_OS_MODE: ${MODE}`,
    );

    console.error(
      "The current launcher is intentionally configured only for simulation.",
    );

    console.error(
      "Real-drone startup will be added separately so it cannot accidentally start SITL.",
    );

    process.exit(1);
  }

  console.log(
    "========================================",
  );

  console.log(
    "           DRONE-OS GCS STARTUP",
  );

  console.log(
    "========================================",
  );

  console.log(
    `Mode:      ${MODE}`,
  );

  console.log(
    `Project:   ${PROJECT_DIR}`,
  );

  console.log(
    `MAVProxy:  ${MAVPROXY}`,
  );

  console.log("");

  /*
   * 1. ROS Core
   *
   * If ROS master is already running, reuse it.
   */
  if (
    await waitForPort(
      11311,
      500,
    )
  ) {
    log(
      "01_roscore: a ROS master is already running on port 11311; reusing it.",
    );
  } else {
    bashService(
      "01_roscore",
      "exec roscore",
    );

    await waitForService(
      "ROS master",
      11311,
      30000,
    );
  }

  /*
   * 2. ROSBridge
   */
  bashService(
    "02_rosbridge",
    "exec roslaunch rosbridge_server rosbridge_websocket.launch",
  );

  await waitForService(
    "ROSBridge",
    9090,
    40000,
  );

  /*
   * 3. Drone SITL
   *
   * ArduPilot Rover is preserved from the supplied script.
   */
  bashService(
    "03_drone_sitl",
    [
      `cd "${ARDUPILOT_DIR}"`,
      "exec python3 Tools/autotest/sim_vehicle.py -v Rover -f rover -I0 --sysid 1 --no-mavproxy --custom-location=19.1685,73.0039,584,0",
    ].join(" && "),
  );

  await waitForService(
    "Drone SITL",
    DRONE_SITL_PORT,
    180000,
  );

  await wait(1000);

  /*
   * 4. Drone MAVProxy
   *
   * SITL TCP 5760
   *        ↓
   * MAVProxy
   *        ↓
   * UDP 14550
   */
  bashService(
    "04_drone_mavproxy",
    [
      `cd "${ARDUPILOT_DIR}"`,
      `exec "${MAVPROXY}" --daemon --retries=5 --master=tcp:127.0.0.1:${DRONE_SITL_PORT} --sitl=127.0.0.1:5501 --out=udp:127.0.0.1:14550`,
    ].join(" && "),
  );

  await wait(1000);

  /*
   * 5. Drone MAVROS
   */
  bashService(
    "05_drone_mavros",
    "exec roslaunch mavros apm.launch fcu_url:=udp://:14550@127.0.0.1:14550 tgt_system:=1 tgt_component:=1 __ns:=/mavros_drone",
  );

  await wait(1000);

  /*
   * 6. FASTY SITL
   */
  bashService(
    "06_fasty_sitl",
    [
      `cd "${ARDUPILOT_DIR}"`,
      "exec python3 Tools/autotest/sim_vehicle.py -v Rover -f rover -I1 --sysid 2 --no-mavproxy --custom-location=19.1685,73.0039,584,0",
    ].join(" && "),
  );

  await waitForService(
    "FASTY SITL",
    FASTY_SITL_PORT,
    180000,
  );

  await wait(1000);

  /*
   * 7. FASTY MAVProxy
   *
   * SITL TCP 5770
   *        ↓
   * MAVProxy
   *        ↓
   * UDP 14552
   */
  bashService(
    "07_fasty_mavproxy",
    [
      `cd "${ARDUPILOT_DIR}"`,
      `exec "${MAVPROXY}" --daemon --retries=5 --master=tcp:127.0.0.1:${FASTY_SITL_PORT} --sitl=127.0.0.1:5511 --out=udp:127.0.0.1:14552`,
    ].join(" && "),
  );

  await wait(1000);

  /*
   * 8. FASTY MAVROS
   */
  bashService(
    "08_fasty_mavros",
    "exec roslaunch mavros apm.launch fcu_url:=udp://:14552@127.0.0.1:14552 tgt_system:=2 tgt_component:=1 __ns:=/mavros_fasty",
  );

  await wait(1000);

  /*
   * 9. SROTA controller
   */
  const rosWsSetup = join(
    ROS_WS,
    "devel",
    "setup.bash",
  );

  if (existsSync(rosWsSetup)) {
    bashService(
      "09_srota_controller",
      `source "${rosWsSetup}" && exec rosrun srota_control srota_control_node`,
    );
  } else {
    log(
      `09_srota_controller: ${rosWsSetup} does not exist.`,
    );
  }

  await wait(1000);

  /*
   * 10. Camera + YOLO detection service.
   */
  if (CAMERA_ENABLED) {
    if (existsSync(rosWsSetup)) {
      bashService(
        "10_camera_ai",
        `source "${rosWsSetup}" && exec rosrun srota_control person_detection_publisher.py _source:=rtsp`,
      );

      await wait(1000);
    } else {
      log(
        `10_camera_ai: ${rosWsSetup} does not exist.`,
      );
    }
  } else {
    log(
      "10_camera_ai: disabled with DRONE_OS_CAMERA=0",
    );
  }

  /*
   * Runtime is now ready.
   */
  console.log("");

  console.log(
    "========================================",
  );

  console.log(
    "        DRONE-OS RUNTIME STARTED",
  );

  console.log(
    "========================================",
  );

  console.log(
    "ROSBridge:  ws://127.0.0.1:9090",
  );

  console.log(
    "Drone:      SITL :5760 -> MAVProxy -> UDP 14550 -> /mavros_drone",
  );

  console.log(
    "FASTY:      SITL :5770 -> MAVProxy -> UDP 14552 -> /mavros_fasty",
  );

  console.log("");

  console.log(
    "DRONE_OS_READY",
  );

  /*
   * 11. Electron Dashboard
   *
   * Start Electron only after the runtime stack has been initialized.
   */
  startElectronDashboard();
}

/*
 * Signal handling
 */

process.on(
  "SIGINT",
  async () => {
    await shutdown("SIGINT");
    process.exit(0);
  },
);

process.on(
  "SIGTERM",
  async () => {
    await shutdown("SIGTERM");
    process.exit(0);
  },
);

process.on(
  "uncaughtException",
  async (error) => {
    console.error(
      "Unhandled Drone-OS startup error:",
      error,
    );

    await shutdown(
      "uncaught exception",
    );

    process.exit(1);
  },
);

process.on(
  "unhandledRejection",
  async (error) => {
    console.error(
      "Unhandled Drone-OS startup rejection:",
      error,
    );

    await shutdown(
      "unhandled rejection",
    );

    process.exit(1);
  },
);

main().catch(
  async (error) => {
    console.error(
      "Drone-OS startup failed:",
      error,
    );

    await shutdown(
      "startup failure",
    );

    process.exit(1);
  },
);
