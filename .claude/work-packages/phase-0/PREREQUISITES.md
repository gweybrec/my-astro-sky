### Prerequisites

Checked on this machine on 2026-10-03:

- **Android SDK:** installed at `C:\Users\guill\AppData\Local\Android\Sdk`, with `adb` on PATH.
- **Java:** `JAVA_HOME` points to `C:\Program Files\Android\Android Studio\jbr`. Gradle uses `JAVA_HOME`.
- **`ANDROID_HOME`:** not set. Cards set it per command and write `sdk.dir` into the gitignored `android/local.properties`.
- **No emulator, ever.** See the device rule in §5.
- **Real device:** you plug in a phone with USB debugging enabled when the orchestrator asks. Each spike report records the device model, Android version and WebView version. If you have several phones, the mid-range one is the reference for performance.
- **Permissions:** the allow/deny list in §6, approved by you.
