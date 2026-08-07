import { initializeApp, FirebaseApp } from "firebase/app";
import {
  getFirestore,
  Firestore,
  collection,
  doc,
  setDoc,
  getDocs,
  query,
  orderBy,
  limit,
} from "firebase/firestore";
import config from "../config/config";
import { MeetingAnalysis } from "./groqService";

export interface MeetingRecord {
  id: string;
  title: string;
  timestamp: string;
  rawTranscript: string;
  analysis: MeetingAnalysis;
  source: string;
}

class FirebaseService {
  private app: FirebaseApp | null = null;
  private db: Firestore | null = null;
  private memoryStore: MeetingRecord[] = [];
  private isFirebaseConfigured = false;

  constructor() {
    this.initFirebase();
  }

  private initFirebase() {
    if (
      config.FIREBASE_API_KEY &&
      config.FIREBASE_PROJECT_ID &&
      config.FIREBASE_APP_ID
    ) {
      try {
        const firebaseConfig = {
          apiKey: config.FIREBASE_API_KEY,
          authDomain: config.FIREBASE_AUTH_DOMAIN,
          projectId: config.FIREBASE_PROJECT_ID,
          storageBucket: config.FIREBASE_STORAGE_BUCKET,
          messagingSenderId: config.FIREBASE_MESSAGING_SENDER_ID,
          appId: config.FIREBASE_APP_ID,
          measurementId: config.FIREBASE_MEASUREMENT_ID,
        };

        this.app = initializeApp(firebaseConfig);
        this.db = getFirestore(this.app);
        this.isFirebaseConfigured = true;
        console.log("Firebase Web SDK successfully initialized (Project: " + config.FIREBASE_PROJECT_ID + ").");
      } catch (error) {
        console.error("Failed to initialize Firebase:", error);
        this.isFirebaseConfigured = false;
      }
    } else {
      console.warn(
        "Firebase credentials not configured. Storing records in fallback memory store."
      );
      this.isFirebaseConfigured = false;
    }
  }

  async saveMeeting(meetingData: {
    title?: string;
    rawTranscript: string;
    analysis: MeetingAnalysis;
    source?: string;
  }): Promise<{
    success: boolean;
    id: string;
    isFirebase: boolean;
    message: string;
  }> {
    const meetingRecord: MeetingRecord = {
      id: `meeting_${Date.now()}`,
      title:
        meetingData.title ||
        `Google Meet Session - ${new Date().toLocaleString()}`,
      timestamp: new Date().toISOString(),
      rawTranscript: meetingData.rawTranscript,
      analysis: meetingData.analysis,
      source: meetingData.source || "Chrome Extension - Google Meet",
    };

    if (this.isFirebaseConfigured && this.db) {
      try {
        const meetingsRef = collection(this.db, "meetings");
        const docRef = doc(meetingsRef, meetingRecord.id);
        await setDoc(docRef, meetingRecord);
        console.log(
          `Meeting record ${meetingRecord.id} saved to Firebase Firestore.`
        );
        return {
          success: true,
          id: meetingRecord.id,
          isFirebase: true,
          message: "Saved successfully to Firebase Firestore database.",
        };
      } catch (error: any) {
        console.error("Error saving meeting to Firebase:", error);
        this.memoryStore.unshift(meetingRecord);
        return {
          success: true,
          id: meetingRecord.id,
          isFirebase: false,
          message: `Firebase write error (${error?.message || "Unknown"}). Stored in fallback memory store.`,
        };
      }
    } else {
      this.memoryStore.unshift(meetingRecord);
      return {
        success: true,
        id: meetingRecord.id,
        isFirebase: false,
        message:
          "Stored in memory. Configure Firebase credentials in server/.env for cloud sync.",
      };
    }
  }

  async getMeetings(): Promise<MeetingRecord[]> {
    if (this.isFirebaseConfigured && this.db) {
      try {
        const meetingsRef = collection(this.db, "meetings");
        const q = query(meetingsRef, orderBy("timestamp", "desc"), limit(20));
        const snapshot = await getDocs(q);
        const records: MeetingRecord[] = [];
        snapshot.forEach((docSnap) => {
          records.push(docSnap.data() as MeetingRecord);
        });
        return records;
      } catch (error) {
        console.error("Error fetching meetings from Firebase:", error);
        return this.memoryStore;
      }
    }
    return this.memoryStore;
  }
}

export default new FirebaseService();
