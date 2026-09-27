import groovy.json.JsonSlurper
import java.util.Properties

plugins {
    id("com.android.application") version "9.4.1"
}

// The game is the static site `npm run build` writes to ../_site; this app is
// only the window it plays in, and takes its version from the game.
val site = rootDir.resolve("../_site")
val gameVersion = (JsonSlurper().parse(rootDir.resolve("../package.json")) as Map<*, *>)["version"] as String
val (major, minor, patch) = gameVersion.split(".").map { it.toInt() }

// The release key stays beside the project and out of git (see README.md).
// Without it, release builds are signed with the debug key so they still install.
val keystoreFile = rootDir.resolve("keystore.properties")
val keystore = Properties().apply { if (keystoreFile.exists()) keystoreFile.inputStream().use { load(it) } }

android {
    namespace = "io.github.mustafaakhan.astra"
    compileSdk = 36

    defaultConfig {
        applicationId = "io.github.mustafaakhan.astra"
        minSdk = 26
        targetSdk = 36
        versionCode = major * 10000 + minor * 100 + patch
        versionName = gameVersion
    }

    signingConfigs {
        if (keystoreFile.exists()) create("release") {
            storeFile = rootDir.resolve(keystore.getProperty("storeFile"))
            storePassword = keystore.getProperty("storePassword")
            keyAlias = keystore.getProperty("keyAlias")
            keyPassword = keystore.getProperty("keyPassword")
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
            signingConfig = signingConfigs.findByName("release") ?: signingConfigs.getByName("debug")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}

androidComponents {
    onVariants { variant -> variant.sources.assets?.addStaticSourceDirectory(site.path) }
}

val checkSite = tasks.register("checkSite") {
    val index = site.resolve("index.html")
    doLast { check(index.exists()) { "No game to package: run `npm run build` first, or `npm run android` to do both." } }
}
tasks.named("preBuild") { dependsOn(checkSite) }

dependencies {
    implementation("androidx.core:core:1.18.0")
    implementation("androidx.webkit:webkit:1.17.1")
}
