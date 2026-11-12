#!/usr/bin/env bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/.." && pwd)"
: "${ANDROID_HOME:?Set ANDROID_HOME (SDK with platform 22 and build-tools 34.0.0)}"
: "${ANDROID_NDK_HOME:?Set ANDROID_NDK_HOME (NDK r27d)}"
: "${JAVA_HOME:?Set JAVA_HOME (JDK 17)}"
case "$(uname -s)" in
  Darwin) ndk_host=darwin-x86_64 ;;
  Linux) ndk_host=linux-x86_64 ;;
  *)
    echo 'macOS or Linux required' >&2
    exit 1
    ;;
esac
tools="$ANDROID_HOME/build-tools/34.0.0"
android_jar="$ANDROID_HOME/platforms/android-22/android.jar"
compiler="$ANDROID_NDK_HOME/toolchains/llvm/prebuilt/$ndk_host/bin/armv7a-linux-androideabi22-clang++"
for tool in "$tools/aapt" "$tools/d8" "$tools/zipalign" "$tools/apksigner" "$compiler" "$JAVA_HOME/bin/javac" "$android_jar"; do
  if [[ ! -f "$tool" ]]; then
    echo "Missing: $tool" >&2
    exit 1
  fi
done
export PATH="$JAVA_HOME/bin:$PATH"
build="$project_dir/android/build"
mkdir -p "$build/classes" "$build/dex" "$build/lib/armeabi-v7a" "$project_dir/dist" "$project_dir/.local"
"$compiler" -shared -fPIC -std=c++17 -fno-exceptions -fno-rtti -fno-threadsafe-statics -nostdlib++ \
  -Wl,--hash-style=both -Wl,--no-undefined -O2 \
  "$project_dir/android/native/epd.cpp" -landroid -ldl -o "$build/lib/armeabi-v7a/librp1_epd.so"
rm -rf "$build/classes" &&
  mkdir -p "$build/classes"
"$JAVA_HOME/bin/javac" -encoding UTF-8 --release 8 -classpath "$android_jar" \
  -d "$build/classes" "$project_dir"/android/src/dev/monocalendar/rp1/*.java
"$JAVA_HOME/bin/jar" cf "$build/classes.jar" -C "$build/classes" .
"$tools/d8" --lib "$android_jar" --min-api 22 --output "$build/dex" "$build/classes.jar"
cp "$build/dex/classes.dex" "$build/classes.dex"
"$tools/aapt" package -f -M "$project_dir/android/AndroidManifest.xml" -S "$project_dir/android/res" -I "$android_jar" -A "$project_dir/android/assets" -F "$build/unaligned.apk"
(cd "$build" && "$tools/aapt" add unaligned.apk classes.dex lib/armeabi-v7a/librp1_epd.so)
"$tools/zipalign" -f 4 "$build/unaligned.apk" "$build/aligned.apk"
keystore="${RP1_KEYSTORE:-$project_dir/.local/debug.keystore}"
export RP1_KEYSTORE_PASSWORD="${RP1_KEYSTORE_PASSWORD:-android}"
if [[ ! -f "$keystore" ]]; then
  "$JAVA_HOME/bin/keytool" -genkeypair -noprompt -storetype JKS -keystore "$keystore" \
    -storepass "$RP1_KEYSTORE_PASSWORD" -keypass "$RP1_KEYSTORE_PASSWORD" \
    -alias androiddebugkey -keyalg RSA -keysize 2048 -validity 10000 \
    -dname 'CN=Mono Calendar'
fi
"$tools/apksigner" sign --ks "$keystore" --ks-pass env:RP1_KEYSTORE_PASSWORD \
  --v1-signing-enabled true --out "$project_dir/dist/rp1-calendar.apk" "$build/aligned.apk"
"$tools/apksigner" verify --min-sdk-version 22 "$project_dir/dist/rp1-calendar.apk"
"$tools/aapt" dump badging "$project_dir/dist/rp1-calendar.apk" > "$build/badging.txt"
python3 "$project_dir/scripts/check-apk.py" "$project_dir/dist/rp1-calendar.apk" "$build/badging.txt"
echo "Built $project_dir/dist/rp1-calendar.apk"
