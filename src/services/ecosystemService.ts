import { db } from '../firebase'; 
import { doc, setDoc, getDoc, getDocFromServer, serverTimestamp, collection, addDoc } from 'firebase/firestore';

export const syncEcosystemUser = async (user: any, appName: string) => {
  if (!user) return;
  const docRef = doc(db, 'users', user.uid);
  try {
    const docSnap = await getDocFromServer(docRef).catch(() => getDoc(docRef));
    const existingData = docSnap.exists() ? docSnap.data() : null;
    const appsUsed = existingData?.appsUsed || [];
    if (!appsUsed.includes(appName)) {
      appsUsed.push(appName);
    }
    await setDoc(docRef, {
      uid: user.uid,
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      lastLogin: existingData ? (existingData.lastLogin || serverTimestamp()) : serverTimestamp(),
      lastActive: serverTimestamp(),
      appsUsed: appsUsed
    }, { merge: true });
  } catch (error) {
    console.error('Ecosystem Sync Failed:', error);
  }
};

export const broadcastActivity = async (userId: string, action: string, metadata: any = {}) => {
  if (!userId) return;
  const activitiesRef = collection(db, 'users', userId, 'activities');
  try {
    await addDoc(activitiesRef, {
      action: `CLEARDAY: ${action}`,
      timestamp: serverTimestamp(),
      metadata: {
        ...metadata,
        source: 'CLEARDAY',
        version: '2.0.0'
      }
    });
  } catch (error) {
    console.error('Activity Broadcast Failed:', error);
  }
};

export const getGlobalProfile = async (userId: string) => {
  if (!userId) return null;
  const docRef = doc(db, 'users', userId);
  try {
    const docSnap = await getDoc(docRef);
    return docSnap.exists() ? docSnap.data() : null;
  } catch (error) {
    console.error('Failed to fetch Global Profile:', error);
    return null;
  }
};
