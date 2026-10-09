const { app, BrowserWindow, shell, dialog } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

const HOST = "127.0.0.1";
const PORT = 1420;
const URL = `http://${HOST}:${PORT}`;
const isDev = !app.isPackaged;

// Packaged app: start the ROS/SITL stack automatically and show the UI only
// once it is ready. Dev: off by default (use `npm run start:gcs`); force with
// DRONE_OS_AUTOSTART=1.
const AUTOSTART =
  (process.env.DRONE_OS_AUTOSTART ?? (isDev ? "0" : "1")) !== "0";

const STACK_READY_TIMEOUT_MS = 180000;

let uiServer = null; // packaged: built TanStack/Nitro server
let stack = null; // ROS/MAVROS/SITL launcher
let stackReady = Promise.resolve(true);
let win = null;
let quitting = false;

function resource(...parts) {
  return isDev
    ? path.join(__dirname, "..", ...parts)
    : path.join(process.resourcesPath, ...parts);
}

// Run a script with Electron's own Node runtime (no system Node needed).
function runWithElectronNode(script, extraEnv = {}, stdio = "ignore") {
  return spawn(process.execPath, [script], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      ...extraEnv,
    },
    stdio,
  });
}

function startUiServer() {
  uiServer = runWithElectronNode(resource("ui", "server", "index.mjs"), {
    HOST,
    PORT: String(PORT),
    NITRO_HOST: HOST,
    NITRO_PORT: String(PORT),
  });

  uiServer.on("exit", () => (uiServer = null));
}

// The launcher prints DRONE_OS_READY once roscore, rosbridge, SITL, MAVROS,
// SROTA and the camera node have all been started.
function startStack() {
  stack = runWithElectronNode(
    resource("scripts", "start-drone-os.mjs"),
    {
      DRONE_OS_NO_DASHBOARD: "1",
    },
    ["ignore", "pipe", "ignore"],
  );

  stackReady = new Promise((resolve) => {
    let tail = "";

    const timer = setTimeout(() => resolve(false), STACK_READY_TIMEOUT_MS);

    stack.stdout.on("data", (chunk) => {
      tail = (tail + chunk).slice(-200);

      if (tail.includes("DRONE_OS_READY")) {
        clearTimeout(timer);
        resolve(true);
      }
    });

    stack.on("exit", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });

  stack.on("exit", () => (stack = null));
}

function waitForServer(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get(URL, (res) => {
        res.resume();
        resolve();
      });

      req.on("error", () => {
        if (Date.now() > deadline) {
          reject(new Error("UI server did not start"));
        } else {
          setTimeout(tryOnce, 300);
        }
      });
    };

    tryOnce();
  });
}

function stopChild(child, graceMs) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode) {
      return resolve();
    }

    const force = setTimeout(() => {
      child.kill("SIGKILL");
    }, graceMs);

    child.once("exit", () => {
      clearTimeout(force);
      resolve();
    });

    child.kill("SIGTERM");
  });
}

async function createWindow() {
  win = new BrowserWindow({
    width: 1400,
    height: 900,
    title: "Drone-OS",
    backgroundColor: "#0b0f14",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.setMenuBarVisibility(false);

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  if (process.env.DRONE_OS_DEVTOOLS === "1") {
    win.webContents.openDevTools({ mode: "detach" });
  }

  try {
    // The UI server must be available before loading the real splashscreen
    // route. This keeps the splashscreen inside the actual TanStack app.
    await waitForServer();

    if (AUTOSTART) {
      // Use the real Drone-OS splashscreen route while the ROS/SITL stack
      // starts in the background.
      await win.loadURL(`${URL}/splashscreen`);

      const ready = await stackReady;

      if (!ready) {
        dialog.showMessageBoxSync(win, {
          type: "warning",
          title: "Drone-OS",
          message: "Some ROS services did not finish starting.",
          detail:
            "Opening the dashboard anyway. Check ~/Drone-OS/logs/startup/ for details.",
        });
      }
    }

    // Once startup is complete, load the normal dashboard.
    await win.loadURL(URL);
  } catch (err) {
    dialog.showErrorBox(
      "Drone-OS",
      `Could not load the dashboard.\n\n${err.message}`,
    );

    app.quit();
  }
}

if (!app.requestSingleInstanceLock()) {
  // A second copy would start a second ROS stack.
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) {
        win.restore();
      }

      win.focus();
    }
  });

  app.whenReady().then(() => {
    if (!isDev) {
      startUiServer();
    }

    if (AUTOSTART) {
      startStack();
    }

    createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });

  // Stop ROS/SITL/etc. cleanly before the app exits.
  app.on("before-quit", async (event) => {
    if (quitting) {
      return;
    }

    event.preventDefault();
    quitting = true;

    await stopChild(stack, 10000);
    await stopChild(uiServer, 2000);

    app.exit(0);
  });
}

