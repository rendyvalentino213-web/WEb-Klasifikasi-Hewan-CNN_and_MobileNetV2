/*
  ESP32 - Kontrol 4 Relay via Firebase Realtime Database
  ---------------------------------------------------------
  Sinkron dengan web "klasifikasi-hewan" (src/firebase.ts).
  Web menulis boolean ke:
      relays/relay1
      relays/relay2
      relays/relay3
      relays/relay4

  Mapping (sesuai App.tsx web):
      Kucing      -> relay1
      Ayam        -> relay2
      Kupu-kupu   -> relay3
      Kuda        -> relay4
      Gajah       -> relay1..relay4 (semua nyala)

  LIBRARY YANG DIBUTUHKAN (install lewat Arduino Library Manager):
    1. "Firebase Arduino Client Library for ESP8266 and ESP32" by Mobizt
       (kadang muncul dengan nama "Firebase ESP Client")

  PENTING - AUTENTIKASI:
    Kode ini pakai Anonymous Sign-In. Di Firebase Console:
      Authentication -> Sign-in method -> aktifkan "Anonymous"
    Kalau Rules Realtime Database kamu masih default (butuh auth != null),
    ini sudah cukup. Kalau Rules kamu public (".read": true, ".write": true),
    anonymous auth ini tetap aman dipakai, tidak akan error.
*/

#include <WiFi.h>
#include <Firebase_ESP_Client.h>
#include "addons/TokenHelper.h"   // untuk debug token status (opsional, dari contoh library)
#include "addons/RTDBHelper.h"    // untuk print hasil RTDB (opsional, dari contoh library)

// ================== KONFIGURASI WIFI ==================
#define WIFI_SSID     "Rumah Panggung Emak"
#define WIFI_PASSWORD "tahunbaru2026"

// ================== KONFIGURASI FIREBASE ==================
#define API_KEY       "AIzaSyDbSxvmbJ8yUExiljNzG0RirI-ocs6Ooxs"
#define DATABASE_URL  "https://klasifikasi-gambar-hewan-default-rtdb.asia-southeast1.firebasedatabase.app"

// ================== PIN RELAY ==================
#define RELAY1_PIN 23
#define RELAY2_PIN 19
#define RELAY3_PIN 18
#define RELAY4_PIN 5

// Ganti jadi 'true' kalau modul relay kamu aktif-LOW (kebanyakan modul relay 5V begini)
// Ganti jadi 'false' kalau relay aktif-HIGH
#define RELAY_ACTIVE_LOW true

FirebaseData   fbdo;      // object untuk stream
FirebaseAuth   auth;
FirebaseConfig config;

void setRelay(uint8_t pin, bool state) {
  if (RELAY_ACTIVE_LOW) {
    digitalWrite(pin, state ? LOW : HIGH);
  } else {
    digitalWrite(pin, state ? HIGH : LOW);
  }
}

void relayAllOff() {
  setRelay(RELAY1_PIN, false);
  setRelay(RELAY2_PIN, false);
  setRelay(RELAY3_PIN, false);
  setRelay(RELAY4_PIN, false);
}

// Callback dipanggil setiap kali ada perubahan data di path "/relays"
void streamCallback(FirebaseStream data) {
  Serial.printf("Update diterima -> path: %s, type: %s\n",
                data.dataPath().c_str(), data.dataType().c_str());

  // Kalau path yang berubah adalah root "/relays" (misalnya baru connect / semua sekaligus)
  if (data.dataPath() == "/") {
    FirebaseJson *json = data.jsonObjectPtr();
    FirebaseJsonData result;

    json->get(result, "relay1"); bool r1 = result.boolValue;
    json->get(result, "relay2"); bool r2 = result.boolValue;
    json->get(result, "relay3"); bool r3 = result.boolValue;
    json->get(result, "relay4"); bool r4 = result.boolValue;

    setRelay(RELAY1_PIN, r1);
    setRelay(RELAY2_PIN, r2);
    setRelay(RELAY3_PIN, r3);
    setRelay(RELAY4_PIN, r4);

    Serial.printf("relay1=%d relay2=%d relay3=%d relay4=%d\n", r1, r2, r3, r4);
  }
  // Kalau hanya satu relay yang berubah, misal path "/relay1"
  else if (data.dataPath() == "/relay1") {
    setRelay(RELAY1_PIN, data.boolData());
    Serial.printf("relay1 -> %d\n", data.boolData());
  }
  else if (data.dataPath() == "/relay2") {
    setRelay(RELAY2_PIN, data.boolData());
    Serial.printf("relay2 -> %d\n", data.boolData());
  }
  else if (data.dataPath() == "/relay3") {
    setRelay(RELAY3_PIN, data.boolData());
    Serial.printf("relay3 -> %d\n", data.boolData());
  }
  else if (data.dataPath() == "/relay4") {
    setRelay(RELAY4_PIN, data.boolData());
    Serial.printf("relay4 -> %d\n", data.boolData());
  }
}

void streamTimeoutCallback(bool timeout) {
  if (timeout) {
    Serial.println("Stream timeout, reconnecting...");
  }
}

void setup() {
  Serial.begin(115200);

  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(RELAY3_PIN, OUTPUT);
  pinMode(RELAY4_PIN, OUTPUT);
  relayAllOff();

  // ---- Koneksi WiFi ----
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Menghubungkan ke WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println();
  Serial.print("Terhubung, IP: ");
  Serial.println(WiFi.localIP());

  // ---- Konfigurasi Firebase ----
  config.api_key = API_KEY;
  config.database_url = DATABASE_URL;

  // Anonymous sign-in (pastikan sudah diaktifkan di Firebase Console)
  auth.user.email = "";
  auth.user.password = "";

  config.token_status_callback = tokenStatusCallback; // dari addons/TokenHelper.h

  Firebase.begin(&config, &auth);
  Firebase.reconnectWiFi(true);

  Serial.println("Menunggu autentikasi Firebase...");
  while (auth.token.uid == "") {
    Serial.print(".");
    delay(300);
  }
  Serial.println("\nFirebase siap. UID: " + String(auth.token.uid.c_str()));

  // ---- Mulai stream (listen) ke path "/relays" ----
  if (!Firebase.RTDB.beginStream(&fbdo, "/relays")) {
    Serial.println("Gagal memulai stream: " + fbdo.errorReason());
  }
  Firebase.RTDB.setStreamCallback(&fbdo, streamCallback, streamTimeoutCallback);
}

void loop() {
  // Tidak perlu isi apa-apa di loop, karena Firebase.RTDB stream
  // sudah berjalan otomatis di background lewat callback.
  delay(10);
}
