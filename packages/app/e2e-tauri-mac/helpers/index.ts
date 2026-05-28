// [fork-only] e2e-tauri-mac helpers — 统一出口
// [feat: e2e-tauri-phase2-mac] 2026-05-28

export {
  runAppleScript,
  activateApp,
  quitApp,
  isProcessRunning,
  waitForAppLaunch,
  getWindowBounds,
  keystrokeWithModifiers,
  typeUnicode,
  clickMenuItem,
  type Modifier,
  type WindowBounds,
} from "./osascript"

export {
  click,
  clickToFront,
  rightClick,
  doubleClick,
  moveTo,
  keyPress,
  type as typeText,
  wait,
  type CliclickKey,
} from "./cliclick"

export {
  takeFullScreen,
  cropImage,
  getFileSize,
  captureWindowArea,
} from "./screencapture"

export {
  getWindowBoundsRetry,
  centerOf,
  anchorOf,
  titleBarAnchor,
} from "./window-bounds"
