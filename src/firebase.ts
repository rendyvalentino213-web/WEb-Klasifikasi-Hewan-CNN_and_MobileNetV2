import { initializeApp } from 'firebase/app';
import { getDatabase, ref, set } from 'firebase/database';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "AIzaSyDbSxvmbJ8yUExiljNzG0RirI-ocs6Ooxs",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "klasifikasi-gambar-hewan.firebaseapp.com",
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL || "https://klasifikasi-gambar-hewan-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "klasifikasi-gambar-hewan",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "klasifikasi-gambar-hewan.firebasestorage.app",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "58865463121",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "1:58865463121:web:0acee02ed247d1b54cad70"
};

// Initialize Firebase only if config is provided
let app;
let database: ReturnType<typeof getDatabase> | null = null;

try {
  if (firebaseConfig.apiKey) {
    app = initializeApp(firebaseConfig);
    database = getDatabase(app);
  }
} catch (error) {
  console.error("Firebase initialization error", error);
}

export const triggerRelay = async (relayName: string, state: boolean) => {
  if (!database) {
    console.warn("Firebase is not initialized. Please configure VITE_FIREBASE_* variables.");
    return;
  }
  
  try {
    const relayRef = ref(database, `relays/${relayName}`);
    await set(relayRef, state);
    console.log(`Relay ${relayName} set to ${state}`);
  } catch (error) {
    console.error("Error setting relay state", error);
  }
};
