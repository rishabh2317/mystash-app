#!/usr/bin/env python3
"""Offline source compatibility checks only; no Gradle, prebuild, APK or iOS build."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
cache = Path.home() / '.gradle/caches/modules-2/files-2.1'

def jar(group, name, version):
    matches = list((cache / group / name / version).glob('*/*.jar'))
    if not matches:
        raise SystemExit(f'Missing cached compiler dependency {name}; nothing downloaded.')
    return matches[0]

compiler = [jar('org.jetbrains.kotlin', name, '2.1.20') for name in
            ('kotlin-compiler-embeddable', 'kotlin-stdlib', 'kotlin-script-runtime', 'kotlin-reflect', 'kotlin-daemon-embeddable')]
compiler += [jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.6.4'), jar('org.jetbrains', 'annotations', '13.0')]
compiler += [jar('org.jetbrains.intellij.deps', 'trove4j', '1.0.20200330')]
sdk = Path.home() / 'Library/Android/sdk/platforms/android-36/android.jar'
store = root / 'modules/mystash-share/android/src/main/java/expo/modules/mystashshare/ShareStore.kt'
with tempfile.TemporaryDirectory(prefix='mystash-find-native-', dir='/private/tmp') as temporary:
    work = Path(temporary)
    stub = work / 'ShareActivity.kt'
    # ShareActivity is unchanged. This isolates the actual encryption/persistence
    # source against Android SDK types without compiling the app/UI/WorkManager.
    stub.write_text('package expo.modules.mystashshare\nclass ShareActivity { companion object { fun validatedUrl(raw: String): String? = raw } }\n')
    subprocess.run(['java', '-cp', ':'.join(map(str, compiler)), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler',
                    '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath',
                    ':'.join(map(str, [sdk, compiler[1], compiler[-2]])), '-d', str(work / 'classes'),
                    str(store), str(stub)], check=True, cwd=root, timeout=60)
print('PASS actual ShareStore Kotlin source compiles against cached Android SDK (URL validator stub only)')
subprocess.run(['swiftc', '-frontend', '-parse', 'modules/mystash-share/ios/ShareCore.swift',
                'modules/mystash-share/ios/MystashShareModule.swift',
                'modules/mystash-share/ios/Tests/ShareCaptureTests.swift'], check=True, cwd=root, timeout=30)
print('PASS Swift source and XCTest syntax; entitled Expo bridge/runtime still required')
sdk_result = subprocess.run(['xcrun', '--sdk', 'iphonesimulator', '--show-sdk-path'],
                            capture_output=True, text=True, timeout=30)
if sdk_result.returncode == 0:
    with tempfile.TemporaryDirectory(prefix='mystash-find-swift-', dir='/private/tmp') as module_cache:
        subprocess.run(['swiftc', '-typecheck', '-sdk', sdk_result.stdout.strip(),
                        '-target', 'arm64-apple-ios15.1-simulator', '-module-cache-path', module_cache,
                        'modules/mystash-share/ios/ShareCore.swift'], cwd=root, check=True, timeout=60)
    print('PASS actual ShareCore typechecks against installed iOS simulator SDK; no linking or app build')
else:
    print('SKIP full ShareCore typecheck: iOS simulator SDK unavailable; syntax check still passed')
