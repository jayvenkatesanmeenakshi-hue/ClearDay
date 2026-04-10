import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { initializeFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyDg97nmS-TwB_gjji2ywv7Wjjh2brIBQ-s",
  authDomain: "clearday-8b28d.firebaseapp.com",
  projectId: "clearday-8b28d",
  storageBucket: "clearday-8b28d.firebasestorage.app",
  messagingSenderId: "597268215751",
  appId: "1:597268215751:web:74d0905e2c95b589748be2",
  measurementId: "G-X602MQGM7M"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
export default app;
