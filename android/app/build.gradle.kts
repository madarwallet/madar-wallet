plugins {
    id("com.android.application")
}

val keystorePath: String? = System.getenv("MADAR_WALLET_KEYSTORE")
val keystorePass: String? = System.getenv("MADAR_WALLET_KS_PASS")

android {
    namespace = "app.madarwallet.test"
    compileSdk = 36

    defaultConfig {
        applicationId = "app.madarwallet.test"
        minSdk = 24
        targetSdk = 36

        versionCode = (System.getenv("MADAR_WALLET_VERSION_CODE") ?: "1").toInt()
        versionName = System.getenv("MADAR_WALLET_VERSION_NAME") ?: "dev"
    }

    signingConfigs {
        create("test") {
            if (keystorePath != null && keystorePass != null) {
                storeFile = file(keystorePath)
                storePassword = keystorePass
                keyAlias = "madar-wallet-test"
                keyPassword = keystorePass
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            isDebuggable = false
            if (keystorePath != null && keystorePass != null) signingConfig = signingConfigs.getByName("test")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    dependenciesInfo {
        includeInApk = false
        includeInBundle = false
    }

    lint {
        checkReleaseBuilds = false
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
    implementation("androidx.core:core:1.1.0")

    implementation("com.google.android.gms:play-services-code-scanner:16.1.0")
}
