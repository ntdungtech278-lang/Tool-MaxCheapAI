// Launches Electron with a clean env. ELECTRON_RUN_AS_NODE (if present in the
// parent shell) makes the electron binary behave as plain Node, which breaks
// `app`. Delete it before spawning so the GUI runtime starts correctly.
const { spawn } = require("child_process");
const electron = require("electron"); // resolves to the electron.exe path

const env = { ...process.env, USE_DEV_SERVER: "1" };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ["."], { stdio: "inherit", env });
child.on("close", (code) => process.exit(code ?? 0));
