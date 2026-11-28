plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

fun config(key: String): String = providers.gradleProperty(key)
    .orElse(providers.environmentVariable(key)).orElse("").get()
fun quoted(value: String) = "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\""
val configuredProject = config("WALLFLOW_SUPABASE_URL")
val configuredKey = config("WALLFLOW_SUPABASE_PUBLISHABLE_KEY")
val configuredHost = config("WALLFLOW_WEB_HOST")
val configuredPackage = config("WALLFLOW_ANDROID_APPLICATION_ID").ifBlank { "com.wallflow.capture" }
require(configuredProject.isBlank() || configuredProject.matches(Regex("https://[A-Za-z0-9.-]+/?")))
require(configuredKey.isBlank() || configuredKey.matches(Regex("sb_publishable_[A-Za-z0-9_-]+")))
require(configuredHost.isBlank() || configuredHost.matches(Regex("[A-Za-z0-9.-]+")))
require(configuredPackage.matches(Regex("[A-Za-z][A-Za-z0-9_]*(\\.[A-Za-z][A-Za-z0-9_]*)+")))

android {
    namespace = "com.wallflow.capture"
    compileSdk = 36
    defaultConfig {
        applicationId = configuredPackage
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.0"
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"
        manifestPlaceholders["wallflowHost"] = configuredHost.ifBlank { "unconfigured.example" }
        buildConfigField("String", "SUPABASE_URL", quoted(configuredProject.trimEnd('/')))
        buildConfigField("String", "SUPABASE_KEY", quoted(configuredKey))
        buildConfigField("String", "WEB_HOST", quoted(configuredHost.lowercase()))
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
}
kotlin { jvmToolchain(17) }

dependencies {
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.2.1")
    androidTestImplementation("androidx.test:runner:1.6.2")
}
