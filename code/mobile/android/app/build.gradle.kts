plugins {
    id("com.android.application")
    id("kotlin-android")
    // The Flutter Gradle Plugin must be applied after the Android and Kotlin Gradle plugins.
    id("dev.flutter.flutter-gradle-plugin")
}

// Push (FCM) da app do munícipe: o plugin do Google só entra quando existe
// src/municipe/google-services.json (fora do git) e se está a compilar o
// flavor municipe. Sem ele a app compila e corre sem notificações
// (lib/municipe/notificacoes.dart). Ver code/mobile/README.md.
val temFirebase = file("src/municipe/google-services.json").exists() &&
    gradle.startParameter.taskNames.any { it.contains("Municipe", ignoreCase = true) }
if (temFirebase) {
    apply(plugin = "com.google.gms.google-services")
}

android {
    // O namespace é o do código Kotlin (MainActivity); o applicationId muda
    // por flavor.
    namespace = "pt.toucamara.mobile"
    compileSdk = flutter.compileSdkVersion
    ndkVersion = flutter.ndkVersion

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    kotlinOptions {
        jvmTarget = JavaVersion.VERSION_17.toString()
    }

    defaultConfig {
        minSdk = maxOf(flutter.minSdkVersion, 23) // flutter_secure_storage
        targetSdk = flutter.targetSdkVersion
        versionCode = flutter.versionCode
        versionName = flutter.versionName
    }

    // Uma só codebase, duas apps (ver code/mobile/README.md):
    //   flutter build apk --flavor equipa   -t lib/main_equipa.dart
    //   flutter build apk --flavor municipe -t lib/main_municipe.dart
    flavorDimensions += "app"
    productFlavors {
        create("equipa") {
            dimension = "app"
            applicationId = "pt.toucamara.equipa"
            resValue("string", "app_name", "Tou, Câmara · Equipa")
        }
        create("municipe") {
            dimension = "app"
            applicationId = "pt.toucamara.municipe"
            resValue("string", "app_name", "Tou, Câmara")
        }
    }

    buildTypes {
        release {
            // Assinatura de produção por configurar (keystore fora do git).
            // Por agora assina com a chave de debug, para `flutter run --release`.
            signingConfig = signingConfigs.getByName("debug")
        }
    }
}

flutter {
    source = "../.."
}
