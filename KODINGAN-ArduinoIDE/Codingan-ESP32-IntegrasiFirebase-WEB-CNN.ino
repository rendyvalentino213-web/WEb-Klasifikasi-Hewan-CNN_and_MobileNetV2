/*
  ESP32 - Kontrol 4 Relay via Firebase Realtime Database (versi simpel, TANPA AUTH)
  -----------------------------------------------------------------------------------
  Rules database kamu saat ini PUBLIC (cuma dibatasi waktu, tanpa cek auth):
      ".read": "now < 1784653200000"
      ".write": "now < 1784653200000"
  Jadi ESP32 tidak perlu login/auth sama sekali, cukup HTTP GET biasa ke REST API-nya.

  Path yang dibaca: relays/relay1, relay2, relay3, relay4 (boolean)
  Sesuai src/firebase.ts di web kamu.

  LIBRARY YANG DIBUTUHKAN (install lewat Arduino Library Manager):
    1. "ArduinoJson" by Benoit Blanchon (versi 6 atau 7)
  (HTTPClient & WiFiClientSecure sudah bawaan core ESP32, tidak perlu install)
*/

#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// ================== KONFIGURASI WIFI ==================
#define WIFI_SSID     "Rumah Panggung Emak"
#define WIFI_PASSWORD "tahunbaru2026"

// ================== KONFIGURASI FIREBASE ==================
// Cukup REST endpoint biasa + ".json" di akhir path, tanpa perlu API key/auth
// karena rules-nya public.
const char* FIREBASE_HOST = "klasifikasi-gambar-hewan-default-rtdb.asia-southeast1.firebasedatabase.app";
const char* RELAYS_PATH   = "/relays.json";

// ================== PIN RELAY ==================
#define RELAY1_PIN 23
#define RELAY2_PIN 19
#define RELAY3_PIN 18
#define RELAY4_PIN 5

// Ganti 'true' kalau modul relay kamu aktif-LOW (kebanyakan modul relay 5V begini)
// Ganti 'false' kalau relay aktif-HIGH
#define RELAY_ACTIVE_LOW true

// Interval polling (ms). 1000 = cek tiap 1 detik.
const unsigned long POLL_INTERVAL = 1000;
unsigned long lastPoll = 0;

// Simpan state terakhir supaya tidak print/tulis pin terus-menerus tiap detik
bool lastR1 = false, lastR2 = false, lastR3 = false, lastR4 = false;
bool firstRun = true;

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

void setup() {
  Serial.begin(115200);

  pinMode(RELAY1_PIN, OUTPUT);
  pinMode(RELAY2_PIN, OUTPUT);
  pinMode(RELAY3_PIN, OUTPUT);
  pinMode(RELAY4_PIN, OUTPUT);
  relayAllOff();

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Menghubungkan ke WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    Serial.print(".");
    delay(300);
  }
  Serial.println();
  Serial.print("Terhubung, IP: ");
  Serial.println(WiFi.localIP());
}

void pollFirebase() {
  WiFiClientSecure client;
  client.setInsecure(); // skip validasi sertifikat (umum dipakai di project ESP32 sederhana)

  HTTPClient http;
  String url = String("https://") + FIREBASE_HOST + RELAYS_PATH;

  if (!http.begin(client, url)) {
    Serial.println("http.begin() gagal");
    return;
  }

  int code = http.GET();
  if (code == 200) {
    String payload = http.getString();

    // payload contoh: {"relay1":true,"relay2":false,"relay3":false,"relay4":false}
    StaticJsonDocument<256> doc;
    DeserializationError err = deserializeJson(doc, payload);

    if (err) {
      Serial.print("Gagal parse JSON: ");
      Serial.println(err.c_str());
    } else if (doc.isNull()) {
      Serial.println("Data /relays masih kosong (null). Pastikan web sudah pernah menulis data.");
    } else {
      bool r1 = doc["relay1"] | false;
      bool r2 = doc["relay2"] | false;
      bool r3 = doc["relay3"] | false;
      bool r4 = doc["relay4"] | false;

      if (firstRun || r1 != lastR1 || r2 != lastR2 || r3 != lastR3 || r4 != lastR4) {
        setRelay(RELAY1_PIN, r1);
        setRelay(RELAY2_PIN, r2);
        setRelay(RELAY3_PIN, r3);
        setRelay(RELAY4_PIN, r4);

        Serial.printf("Update relay -> r1=%d r2=%d r3=%d r4=%d\n", r1, r2, r3, r4);

        lastR1 = r1; lastR2 = r2; lastR3 = r3; lastR4 = r4;
        firstRun = false;
      }
    }
  } else {
    Serial.printf("HTTP GET gagal, kode: %d\n", code);
    Serial.println(http.getString());
  }

  http.end();
}

void loop() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("WiFi terputus, mencoba reconnect...");
    WiFi.reconnect();
    delay(1000);
    return;
  }

  unsigned long now = millis();
  if (now - lastPoll >= POLL_INTERVAL) {
    lastPoll = now;
    pollFirebase();
  }
}
