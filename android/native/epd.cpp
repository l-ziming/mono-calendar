// Loads Sony's e-paper driver library at run time and checks its ARM32 ABI before calling into it.
#include <android/native_window_jni.h>
#include <dlfcn.h>
#include <jni.h>
#include <stdint.h>

extern "C" JNIEXPORT jboolean JNICALL Java_dev_monocalendar_rp1_MainActivity_refreshHint(JNIEnv* env, jclass,
                                                                                         jobject surface, jint mode,
                                                                                         jint left, jint top,
                                                                                         jint right, jint bottom) {
    if (sizeof(void*) != 4 || (mode != 16386 && mode != 8226))
        return JNI_FALSE;
    static void* surfaceLibrary = dlopen("/system/lib/libgui.so", RTLD_NOW);
    if (!surfaceLibrary)
        return JNI_FALSE;
    using DirtyRectSetter = void (*)(void*, int*, int);
    static auto setDirtyRectGroup =
        reinterpret_cast<DirtyRectSetter>(dlsym(surfaceLibrary, "_ZN7android7Surface17setDirtyRectGroupEPii"));
    static auto surfaceVtable = reinterpret_cast<uintptr_t>(dlsym(surfaceLibrary, "_ZTVN7android7SurfaceE"));
    static auto hookPerform =
        reinterpret_cast<uintptr_t>(dlsym(surfaceLibrary, "_ZN7android7Surface12hook_performEP13ANativeWindowiz"));
    if (!setDirtyRectGroup || !surfaceVtable || !hookPerform)
        return JNI_FALSE;
    auto window = ANativeWindow_fromSurface(env, surface);
    if (!window)
        return JNI_FALSE;
    if (left < 0 || top < 0 || left >= right || top >= bottom || right > ANativeWindow_getWidth(window) ||
        bottom > ANativeWindow_getHeight(window)) {
        ANativeWindow_release(window);
        return JNI_FALSE;
    }
    auto rawWindow = reinterpret_cast<unsigned char*>(window);
    auto surfaceObject = rawWindow - 8;
    bool compatible = *reinterpret_cast<uintptr_t*>(rawWindow + 0x58) == hookPerform &&
                      *reinterpret_cast<uintptr_t*>(surfaceObject) == surfaceVtable + 8;
    if (compatible) {
        int group[] = {left, top, right, bottom, mode};
        setDirtyRectGroup(surfaceObject, group, 5);
    }
    ANativeWindow_release(window);
    return compatible ? JNI_TRUE : JNI_FALSE;
}
