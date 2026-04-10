/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, Variants } from 'motion/react';
import { 
  Sparkles, 
  Calendar, 
  Loader2, 
  Heart, 
  AlertCircle,
  Clock,
  Zap,
  ArrowLeft,
  Flower2,
  Moon,
  Sun,
  Coffee,
  LogOut,
  User as UserIcon,
  Lock,
  Eye,
  EyeOff,
  CheckCircle2
} from 'lucide-react';
import Markdown from 'react-markdown';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { processBrainDump, generateTodayPlan } from './services/gemini';
import { auth, db } from './firebase';
import { 
  onAuthStateChanged, 
  signOut,
  User,
  GoogleAuthProvider,
  signInWithPopup
} from 'firebase/auth';
import { doc, setDoc, getDoc, onSnapshot, getDocFromServer } from 'firebase/firestore';

enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { hasError: boolean, errorInfo: string | null }> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, errorInfo: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, errorInfo: error.message };
  }

  render() {
    if (this.state.hasError) {
      let displayMessage = "Something went wrong.";
      try {
        const parsed = JSON.parse(this.state.errorInfo || "");
        if (parsed.error) displayMessage = `Database Error: ${parsed.error}`;
      } catch (e) {
        displayMessage = this.state.errorInfo || displayMessage;
      }

      return (
        <div className="min-h-screen flex items-center justify-center bg-aesthetic-bg p-8">
          <div className="max-w-md w-full bg-white border border-aesthetic-lavender rounded-[2.5rem] p-10 text-center space-y-6 shadow-xl">
            <AlertCircle className="w-16 h-16 text-red-400 mx-auto" />
            <h2 className="text-2xl font-serif italic text-aesthetic-ink">A small ripple in the journey</h2>
            <p className="text-aesthetic-ink/60 font-light">{displayMessage}</p>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-aesthetic-lavender-deep text-white rounded-full font-medium hover:bg-aesthetic-lavender-deep/90 transition-all"
            >
              Try Again
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type Step = 'auth' | 'home' | 'dump' | 'process' | 'plan' | 'execute';
type AuthMode = 'login' | 'signup';

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
}

const containerVariants: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.1,
      delayChildren: 0.2
    }
  },
  exit: {
    opacity: 0,
    transition: {
      staggerChildren: 0.05,
      staggerDirection: -1
    }
  }
};

const itemVariants: Variants = {
  hidden: { y: 20, opacity: 0 },
  visible: {
    y: 0,
    opacity: 1,
    transition: {
      type: "spring",
      stiffness: 300,
      damping: 24
    }
  },
  exit: { y: -20, opacity: 0 }
};

export default function AppWrapper() {
  return (
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  );
}

function App() {
  const [step, setStep] = useState<Step>('auth');
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);
  const [user, setUser] = useState<User | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [rawText, setRawText] = useState('');
  const [processedTasks, setProcessedTasks] = useState('');
  const [todayPlan, setTodayPlan] = useState('');
  const [checklist, setChecklist] = useState<ChecklistItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Plan inputs
  const [availableTime, setAvailableTime] = useState('4 hours');
  const [energyLevel, setEnergyLevel] = useState<'Low' | 'Medium' | 'High'>('Medium');
  const [startTime, setStartTime] = useState('09:00');
  const [endTime, setEndTime] = useState('17:00');

  const toggleAmPm = (time: string, setter: (val: string) => void) => {
    let [hours, minutes] = time.split(':').map(Number);
    hours = (hours + 12) % 24;
    setter(`${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`);
  };

  const getAmPm = (time: string) => {
    const hours = parseInt(time.split(':')[0]);
    return hours >= 12 ? 'PM' : 'AM';
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        setStep('home');
      } else {
        setStep('auth');
      }
      setIsAuthLoading(false);
    });
    return () => unsubscribe();
  }, []);

  useEffect(() => {
    const testConnection = async () => {
      // Small delay to allow Firestore to initialize its connection
      await new Promise(resolve => setTimeout(resolve, 2000));
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
        console.log("Firebase connection successful.");
      } catch (error) {
        console.error("Firebase connection test error:", error);
        // If it's a permission error, the connection is actually working
        if (error instanceof Error && (error.message.includes('permission-denied') || error.message.includes('Permission denied'))) {
          console.log("Firebase connection successful (Permission Denied is expected for test doc).");
          return;
        }
        if (error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration. The client is offline. Enabling long polling might help.");
        }
      }
    };
    testConnection();
  }, []);

  // Sync with Firestore
  useEffect(() => {
    if (!user) return;

    const ritualRef = doc(db, 'rituals', user.uid);
    const unsubscribe = onSnapshot(ritualRef, (docSnap) => {
      if (docSnap.exists()) {
        const data = docSnap.data();
        setRawText(data.rawText || '');
        setProcessedTasks(data.processedTasks || '');
        setTodayPlan(data.todayPlan || '');
        setChecklist(data.checklist || []);
        setAvailableTime(data.availableTime || '4 hours');
        setEnergyLevel(data.energyLevel || 'Medium');
        setStartTime(data.startTime || '09:00');
        setEndTime(data.endTime || '17:00');
      }
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, `rituals/${user.uid}`);
    });

    return () => unsubscribe();
  }, [user]);

  const saveRitual = async (updates: any) => {
    if (!user) return;
    const path = `rituals/${user.uid}`;
    try {
      const ritualRef = doc(db, 'rituals', user.uid);
      await setDoc(ritualRef, { ...updates, updatedAt: new Date().toISOString() }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  };

  const handleGoogleSignIn = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      setStep('home');
    } catch (err: any) {
      setError(err.message || 'Google Sign-in failed');
    } finally {
      setIsLoading(false);
    }
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
      setUser(null);
      setStep('auth');
    } catch (err) {
      console.error('Logout failed', err);
    }
  };

  const handleProcessDump = async () => {
    if (!rawText.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await processBrainDump(rawText);
      setProcessedTasks(result || '');
      await saveRitual({ rawText, processedTasks: result || '' });
      setStep('process');
    } catch (err) {
      setError('Something went wrong. Let\'s try again, darling.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleGeneratePlan = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const workHours = `${startTime} - ${endTime}`;
      const result = await generateTodayPlan(processedTasks, availableTime, energyLevel, workHours);
      setTodayPlan(result || '');
      
      // Parse tasks for checklist
      let items: ChecklistItem[] = [];
      if (result) {
        const lines = result.split('\n');
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed && (trimmed.includes('→') || trimmed.includes('-'))) {
            items.push({
              id: `task-${index}`,
              text: trimmed,
              completed: false
            });
          }
        });
        setChecklist(items);
      }
      
      await saveRitual({ 
        todayPlan: result || '', 
        checklist: items,
        availableTime,
        energyLevel,
        startTime,
        endTime
      });
      setStep('plan');
    } catch (err) {
      setError('Failed to create your dream schedule. Try once more.');
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const reset = async () => {
    setStep('dump');
    setRawText('');
    setProcessedTasks('');
    setTodayPlan('');
    setChecklist([]);
    setError(null);
    await saveRitual({
      rawText: '',
      processedTasks: '',
      todayPlan: '',
      checklist: []
    });
  };

  const toggleTask = async (id: string) => {
    const newChecklist = checklist.map(item => 
      item.id === id ? { ...item, completed: !item.completed } : item
    );
    setChecklist(newChecklist);
    await saveRitual({ checklist: newChecklist });
  };

  if (isAuthLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-aesthetic-bg">
        <Loader2 className="w-8 h-8 animate-spin text-aesthetic-lavender-deep" />
      </div>
    );
  }

  if (!user || step === 'auth') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-aesthetic-bg selection:bg-aesthetic-lavender selection:text-aesthetic-lavender-deep relative overflow-hidden">
        {/* Decorative Background Patterns */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <motion.div 
            animate={{ 
              scale: [1, 1.2, 1], 
              x: [0, 50, 0],
              y: [0, 30, 0] 
            }}
            transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -top-48 -left-48 w-[40rem] h-[40rem] bg-aesthetic-lavender/30 rounded-full blur-[120px]" 
          />
          <motion.div 
            animate={{ 
              scale: [1, 1.3, 1], 
              x: [0, -40, 0],
              y: [0, -50, 0] 
            }}
            transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
            className="absolute -bottom-48 -right-48 w-[45rem] h-[45rem] bg-aesthetic-accent/20 rounded-full blur-[120px]" 
          />
        </div>

        <main className="w-full max-w-5xl grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-24 items-center relative z-10">
          <motion.div
            variants={containerVariants}
            initial="hidden"
            animate="visible"
            className="space-y-10"
          >
            <motion.div variants={itemVariants} className="space-y-6">
              <div className="inline-flex items-center gap-3 px-4 py-2 bg-white/50 border border-aesthetic-lavender rounded-full backdrop-blur-sm">
                <Sparkles className="text-aesthetic-lavender-deep w-4 h-4" />
                <span className="text-[10px] font-bold uppercase tracking-[0.2em] text-aesthetic-lavender-deep">Your Mindful Companion</span>
              </div>
              <h1 className="text-6xl lg:text-8xl font-display italic text-aesthetic-ink tracking-tight leading-[0.9]">
                ClearDay
              </h1>
              <p className="text-aesthetic-ink/60 text-xl lg:text-2xl font-light leading-relaxed max-w-md">
                Transform chaotic thoughts into a structured journey. Find clarity in the ritual of planning.
              </p>
            </motion.div>

            <motion.div variants={itemVariants} className="flex flex-col sm:flex-row gap-4">
              <button
                onClick={handleGoogleSignIn}
                disabled={isLoading}
                className="group relative flex items-center justify-center gap-4 px-8 py-5 bg-aesthetic-lavender-deep text-white rounded-full font-medium transition-all hover:shadow-2xl hover:shadow-aesthetic-lavender-deep/30 active:scale-95 disabled:opacity-50 overflow-hidden"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/10 to-white/0 translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000" />
                {isLoading ? (
                  <Loader2 className="w-6 h-6 animate-spin" />
                ) : (
                  <svg className="w-6 h-6 fill-current" viewBox="0 0 24 24">
                    <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                    <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                    <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" />
                    <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                  </svg>
                )}
                <span className="text-lg">Begin with Google</span>
              </button>
            </motion.div>

            {error && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-red-50/50 border border-red-100 rounded-2xl flex items-center gap-3 text-red-600 text-xs italic font-serif"
              >
                <AlertCircle className="w-4 h-4 flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </motion.div>

          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 1, delay: 0.5 }}
            className="hidden lg:block relative"
          >
            <div className="absolute inset-0 bg-aesthetic-lavender/20 rounded-[3rem] rotate-3 blur-2xl" />
            <div className="relative bg-white/40 backdrop-blur-md border border-white/50 rounded-[3rem] p-12 shadow-2xl space-y-8">
              <div className="flex items-center gap-4">
                <div className="w-3 h-3 rounded-full bg-red-300" />
                <div className="w-3 h-3 rounded-full bg-yellow-300" />
                <div className="w-3 h-3 rounded-full bg-green-300" />
              </div>
              <div className="space-y-4">
                <div className="h-4 w-3/4 bg-aesthetic-lavender/30 rounded-full" />
                <div className="h-4 w-1/2 bg-aesthetic-lavender/20 rounded-full" />
                <div className="h-32 w-full bg-white/50 rounded-3xl border border-aesthetic-lavender/30 p-6">
                  <div className="space-y-3">
                    <div className="h-2 w-full bg-aesthetic-lavender-deep/10 rounded-full" />
                    <div className="h-2 w-5/6 bg-aesthetic-lavender-deep/10 rounded-full" />
                    <div className="h-2 w-4/6 bg-aesthetic-lavender-deep/10 rounded-full" />
                  </div>
                </div>
              </div>
              <div className="flex justify-between items-center">
                <div className="flex -space-x-2">
                  {[1,2,3].map(i => (
                    <div key={i} className="w-8 h-8 rounded-full bg-aesthetic-lavender/40 border-2 border-white" />
                  ))}
                </div>
                <div className="h-8 w-24 bg-aesthetic-lavender-deep/20 rounded-full" />
              </div>
            </div>
            
            {/* Floating elements */}
            <motion.div
              animate={{ y: [0, -20, 0] }}
              transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }}
              className="absolute -top-12 -right-12 w-24 h-24 bg-white rounded-3xl shadow-xl flex items-center justify-center border border-aesthetic-lavender"
            >
              <Heart className="w-10 h-10 text-aesthetic-lavender-deep" />
            </motion.div>
            <motion.div
              animate={{ y: [0, 20, 0] }}
              transition={{ duration: 5, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute -bottom-8 -left-8 w-20 h-20 bg-aesthetic-accent/20 rounded-full blur-xl"
            />
          </motion.div>
        </main>

        <footer className="absolute bottom-8 text-aesthetic-ink/30 text-[10px] font-bold uppercase tracking-[0.3em]">
          © 2026 ClearDay • Mindful Productivity
        </footer>
      </div>
    );
  }

  const navItems = [
    { id: 'home', label: 'Overview', icon: Heart },
    { id: 'dump', label: 'Mindful Release', icon: Flower2 },
    { id: 'process', label: 'Journey Structure', icon: Sparkles },
    { id: 'plan', label: 'Daily Ritual', icon: Calendar },
    { id: 'execute', label: 'Execution Mode', icon: CheckCircle2 },
  ];

  return (
    <div className="min-h-screen flex bg-aesthetic-bg selection:bg-aesthetic-lavender selection:text-aesthetic-lavender-deep relative overflow-hidden">
      {/* Sidebar */}
      <aside 
        className={cn(
          "fixed inset-y-0 left-0 z-50 w-72 bg-white border-r border-aesthetic-lavender transition-transform duration-300 ease-in-out lg:translate-x-0 lg:static lg:inset-0",
          !isSidebarOpen && "-translate-x-full"
        )}
      >
        <div className="h-full flex flex-col p-8">
          <div className="flex items-center gap-3 mb-12">
            <div className="w-8 h-8 bg-aesthetic-lavender/30 border border-aesthetic-lavender rounded-xl flex items-center justify-center shadow-sm">
              <Sparkles className="text-aesthetic-lavender-deep w-4 h-4" />
            </div>
            <h1 className="text-xl font-display italic text-aesthetic-ink tracking-tight">ClearDay</h1>
          </div>

          <nav className="flex-1 space-y-2">
            {navItems.map((item) => (
              <button
                key={item.id}
                onClick={() => setStep(item.id as Step)}
                className={cn(
                  "w-full flex items-center gap-4 px-6 py-4 rounded-2xl transition-all text-left font-serif italic text-lg",
                  step === item.id 
                    ? "bg-aesthetic-lavender/20 text-aesthetic-lavender-deep shadow-sm" 
                    : "text-aesthetic-ink/40 hover:bg-aesthetic-bg hover:text-aesthetic-ink/60"
                )}
              >
                <item.icon className={cn("w-5 h-5", step === item.id ? "text-aesthetic-lavender-deep" : "text-aesthetic-ink/30")} />
                {item.label}
              </button>
            ))}
          </nav>

          <div className="mt-auto pt-8 border-t border-aesthetic-lavender space-y-4">
            <div className="flex items-center gap-3 px-4">
              <div className="w-10 h-10 bg-aesthetic-accent/10 rounded-full flex items-center justify-center">
                <UserIcon className="w-5 h-5 text-aesthetic-lavender-deep" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-aesthetic-ink truncate">{user.displayName || user.email?.split('@')[0]}</p>
                <p className="text-[10px] text-aesthetic-ink/40 uppercase tracking-widest font-bold">Free Plan</p>
              </div>
            </div>
            <button 
              onClick={handleLogout}
              className="w-full flex items-center gap-4 px-6 py-4 rounded-2xl text-aesthetic-ink/40 hover:bg-red-50 hover:text-red-500 transition-all font-serif italic text-lg"
            >
              <LogOut className="w-5 h-5" />
              Logout
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
        {/* Decorative Background Patterns */}
        <div className="fixed inset-0 pointer-events-none overflow-hidden z-0">
          <motion.div 
            animate={{ scale: [1, 1.1, 1], rotate: [0, 5, 0] }}
            transition={{ duration: 20, repeat: Infinity, ease: "linear" }}
            className="absolute -top-24 -left-24 w-96 h-96 bg-aesthetic-lavender/20 rounded-full blur-3xl opacity-50" 
          />
          <motion.div 
            animate={{ scale: [1, 1.2, 1], rotate: [0, -10, 0] }}
            transition={{ duration: 25, repeat: Infinity, ease: "linear" }}
            className="absolute bottom-0 right-0 w-[30rem] h-[30rem] bg-aesthetic-accent/10 rounded-full blur-3xl opacity-50" 
          />
        </div>

        <header className="h-20 flex items-center justify-between px-8 relative z-10 lg:hidden">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="p-2 text-aesthetic-ink/40 hover:text-aesthetic-lavender-deep transition-colors"
          >
            <Sparkles className="w-6 h-6" />
          </button>
          <h1 className="text-xl font-display italic text-aesthetic-ink">ClearDay</h1>
          <div className="w-10" />
        </header>

        <main className="flex-1 overflow-y-auto p-8 lg:p-12 relative z-10">
          <div className="max-w-4xl mx-auto">
            <AnimatePresence mode="wait">
              {step === 'home' && (
                <motion.div
                  key="home"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="space-y-10"
                >
                  <motion.div variants={itemVariants} className="space-y-3">
                    <h2 className="text-4xl font-serif italic text-aesthetic-lavender-deep">Welcome, {user.displayName || user.email?.split('@')[0]}</h2>
                    <p className="text-aesthetic-ink/60 text-lg font-light tracking-wide">
                      Your mindful journey continues. How shall we shape your day?
                    </p>
                  </motion.div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <motion.button
                      variants={itemVariants}
                      whileHover={{ scale: 1.02, y: -4 }}
                      onClick={() => setStep('dump')}
                      className="p-8 bg-white border border-aesthetic-lavender rounded-[2.5rem] text-left space-y-4 hover:shadow-lg hover:shadow-aesthetic-lavender/20 transition-all group"
                    >
                      <div className="w-12 h-12 bg-aesthetic-lavender/30 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <Flower2 className="w-6 h-6 text-aesthetic-lavender-deep" />
                      </div>
                      <div>
                        <h3 className="text-xl font-serif italic text-aesthetic-ink">Mindful Release</h3>
                        <p className="text-sm text-aesthetic-ink/40">Empty your mind and find clarity.</p>
                      </div>
                    </motion.button>

                    <motion.button
                      variants={itemVariants}
                      whileHover={{ scale: 1.02, y: -4 }}
                      onClick={() => setStep('execute')}
                      className="p-8 bg-white border border-aesthetic-lavender rounded-[2.5rem] text-left space-y-4 hover:shadow-lg hover:shadow-aesthetic-lavender/20 transition-all group"
                    >
                      <div className="w-12 h-12 bg-aesthetic-accent/20 rounded-2xl flex items-center justify-center group-hover:scale-110 transition-transform">
                        <CheckCircle2 className="w-6 h-6 text-aesthetic-lavender-deep" />
                      </div>
                      <div>
                        <h3 className="text-xl font-serif italic text-aesthetic-ink">Execution Mode</h3>
                        <p className="text-sm text-aesthetic-ink/40">
                          {checklist.length > 0 
                            ? `${checklist.filter(c => c.completed).length}/${checklist.length} tasks completed`
                            : "No active ritual. Start one today."}
                        </p>
                      </div>
                    </motion.button>
                  </div>

                  {todayPlan && (
                    <motion.div variants={itemVariants} className="bg-white border border-aesthetic-lavender rounded-[2.5rem] p-10 space-y-6">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <Calendar className="w-5 h-5 text-aesthetic-lavender-deep" />
                          <h3 className="text-xl font-serif italic text-aesthetic-ink">Current Ritual</h3>
                        </div>
                        <button 
                          onClick={() => setStep('plan')}
                          className="text-xs font-bold uppercase tracking-widest text-aesthetic-lavender-deep hover:underline"
                        >
                          View Full Plan
                        </button>
                      </div>
                      <div className="p-6 bg-aesthetic-bg/50 rounded-3xl border border-aesthetic-lavender/50 italic text-aesthetic-ink/60 line-clamp-3">
                        {todayPlan}
                      </div>
                    </motion.div>
                  )}
                </motion.div>
              )}

              {step === 'dump' && (
                <motion.div
                  key="dump"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="space-y-8"
                >
                  <motion.div variants={itemVariants} className="space-y-3">
                    <h2 className="text-4xl font-serif italic text-aesthetic-lavender-deep">Mindful Release</h2>
                    <p className="text-aesthetic-ink/60 text-lg font-light tracking-wide">
                      Let it all out. Every thought, every task, every dream.
                    </p>
                  </motion.div>
                  <motion.div variants={itemVariants} className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-aesthetic-lavender to-aesthetic-lavender-deep rounded-[2.5rem] blur opacity-20 group-hover:opacity-30 transition duration-1000 group-hover:duration-200"></div>
                    <textarea
                      value={rawText}
                      onChange={(e) => setRawText(e.target.value)}
                      placeholder="What's on your heart today? List it all here..."
                      className="relative w-full h-96 p-10 bg-white border border-aesthetic-lavender rounded-[2.5rem] shadow-sm focus:outline-none focus:ring-2 focus:ring-aesthetic-lavender/50 resize-none font-sans text-xl leading-relaxed placeholder:text-aesthetic-ink/30"
                    />
                  </motion.div>
                  <motion.button
                    variants={itemVariants}
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={handleProcessDump}
                    disabled={isLoading || !rawText.trim()}
                    className="w-full py-6 bg-aesthetic-lavender-deep text-white rounded-full font-medium flex items-center justify-center gap-3 hover:bg-aesthetic-lavender-deep/90 transition-all shadow-lg shadow-aesthetic-lavender-deep/20 disabled:opacity-50 disabled:cursor-not-allowed text-lg"
                  >
                    {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Flower2 className="w-6 h-6" />}
                    Organize My Thoughts
                  </motion.button>
                </motion.div>
              )}

              {step === 'process' && (
                <motion.div
                  key="process"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="space-y-10"
                >
                  <motion.div variants={itemVariants} className="space-y-3">
                    <h2 className="text-4xl font-serif italic text-aesthetic-lavender-deep">Journey Structure</h2>
                    <p className="text-aesthetic-ink/60 text-lg font-light">A beautiful structure for your day.</p>
                  </motion.div>

                  {!processedTasks ? (
                    <motion.div variants={itemVariants} className="bg-white border border-aesthetic-lavender rounded-[2.5rem] p-20 text-center space-y-6">
                      <div className="w-20 h-20 bg-aesthetic-bg rounded-full flex items-center justify-center mx-auto">
                        <Flower2 className="w-10 h-10 text-aesthetic-lavender-deep opacity-30" />
                      </div>
                      <p className="text-aesthetic-ink/40 font-serif italic text-xl">Start with a Mindful Release to see your journey here.</p>
                      <button 
                        onClick={() => setStep('dump')}
                        className="px-8 py-4 bg-aesthetic-lavender/20 text-aesthetic-lavender-deep rounded-full font-medium hover:bg-aesthetic-lavender/40 transition-all"
                      >
                        Go to Mindful Release
                      </button>
                    </motion.div>
                  ) : (
                    <>
                      <motion.div variants={itemVariants} className="bg-white border border-aesthetic-lavender rounded-[2.5rem] shadow-sm p-12 markdown-body font-sans relative overflow-hidden">
                        <div className="absolute top-0 right-0 p-8 opacity-10">
                          <Heart className="w-16 h-16 text-aesthetic-lavender-deep" />
                        </div>
                        <Markdown>{processedTasks}</Markdown>
                      </motion.div>

                      <motion.div variants={itemVariants} className="bg-white border border-aesthetic-lavender rounded-[2.5rem] shadow-sm p-12 space-y-10">
                        <div className="flex items-center gap-4">
                          <Coffee className="w-6 h-6 text-aesthetic-lavender-deep" />
                          <h3 className="font-serif italic text-2xl text-aesthetic-ink">Set the Vibe</h3>
                        </div>
                        
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-10">
                          <div className="space-y-4">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-aesthetic-ink/40 flex items-center gap-2">
                              <Clock className="w-3 h-3" /> Time for You
                            </label>
                            <input
                              type="text"
                              value={availableTime}
                              onChange={(e) => setAvailableTime(e.target.value)}
                              className="w-full p-5 bg-aesthetic-bg/50 border border-aesthetic-lavender rounded-2xl focus:outline-none focus:ring-2 focus:ring-aesthetic-lavender/50 transition-all"
                            />
                          </div>
                          <div className="space-y-4">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-aesthetic-ink/40 flex items-center gap-2">
                              <Zap className="w-3 h-3" /> Energy Flow
                            </label>
                            <div className="flex gap-2 p-1.5 bg-aesthetic-bg/50 rounded-2xl border border-aesthetic-lavender">
                              {(['Low', 'Medium', 'High'] as const).map((level) => (
                                <button
                                  key={level}
                                  onClick={() => setEnergyLevel(level)}
                                  className={cn(
                                    "flex-1 py-3 text-xs font-medium rounded-xl transition-all",
                                    energyLevel === level 
                                      ? "bg-white text-aesthetic-lavender-deep shadow-sm" 
                                      : "text-aesthetic-ink/40 hover:text-aesthetic-ink/60"
                                  )}
                                >
                                  {level}
                                </button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-aesthetic-ink/40 flex items-center gap-2">
                              <Sun className="w-3 h-3" /> Start Time
                            </label>
                            <div className="flex gap-3">
                              <input
                                type="time"
                                value={startTime}
                                onChange={(e) => setStartTime(e.target.value)}
                                className="flex-1 p-5 bg-aesthetic-bg/50 border border-aesthetic-lavender rounded-2xl focus:outline-none focus:ring-2 focus:ring-aesthetic-lavender/50 transition-all"
                              />
                              <button
                                type="button"
                                onClick={() => toggleAmPm(startTime, setStartTime)}
                                className="px-6 bg-aesthetic-lavender/20 border border-aesthetic-lavender rounded-2xl text-[10px] font-bold text-aesthetic-lavender-deep hover:bg-aesthetic-lavender/40 transition-all"
                              >
                                {getAmPm(startTime)}
                              </button>
                            </div>
                          </div>
                          <div className="space-y-4">
                            <label className="text-[10px] font-bold uppercase tracking-[0.2em] text-aesthetic-ink/40 flex items-center gap-2">
                              <Moon className="w-3 h-3" /> End Time
                            </label>
                            <div className="flex gap-3">
                              <input
                                type="time"
                                value={endTime}
                                onChange={(e) => setEndTime(e.target.value)}
                                className="flex-1 p-5 bg-aesthetic-bg/50 border border-aesthetic-lavender rounded-2xl focus:outline-none focus:ring-2 focus:ring-aesthetic-lavender/50 transition-all"
                              />
                              <button
                                type="button"
                                onClick={() => toggleAmPm(endTime, setEndTime)}
                                className="px-6 bg-aesthetic-lavender/20 border border-aesthetic-lavender rounded-2xl text-[10px] font-bold text-aesthetic-lavender-deep hover:bg-aesthetic-lavender/40 transition-all"
                              >
                                {getAmPm(endTime)}
                              </button>
                            </div>
                          </div>
                        </div>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={handleGeneratePlan}
                          disabled={isLoading}
                          className="w-full py-6 bg-aesthetic-ink text-white rounded-full font-medium flex items-center justify-center gap-3 hover:bg-aesthetic-ink/90 transition-all shadow-lg disabled:opacity-50 text-lg"
                        >
                          {isLoading ? <Loader2 className="w-6 h-6 animate-spin" /> : <Calendar className="w-6 h-6" />}
                          Create My Dream Day
                        </motion.button>
                      </motion.div>
                    </>
                  )}
                </motion.div>
              )}

              {step === 'plan' && (
                <motion.div
                  key="plan"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="space-y-10"
                >
                  <motion.div variants={itemVariants} className="space-y-3">
                    <h2 className="text-4xl font-serif italic text-aesthetic-lavender-deep">Daily Ritual</h2>
                    <p className="text-aesthetic-ink/60 text-lg font-light">Gentle reminders for a peaceful day.</p>
                  </motion.div>

                  {!todayPlan ? (
                    <motion.div variants={itemVariants} className="bg-white border border-aesthetic-lavender rounded-[2.5rem] p-20 text-center space-y-6">
                      <div className="w-20 h-20 bg-aesthetic-bg rounded-full flex items-center justify-center mx-auto">
                        <Calendar className="w-10 h-10 text-aesthetic-lavender-deep opacity-30" />
                      </div>
                      <p className="text-aesthetic-ink/40 font-serif italic text-xl">Configure your vibe in Journey Structure to see your ritual here.</p>
                      <button 
                        onClick={() => setStep('process')}
                        className="px-8 py-4 bg-aesthetic-lavender/20 text-aesthetic-lavender-deep rounded-full font-medium hover:bg-aesthetic-lavender/40 transition-all"
                      >
                        Go to Journey Structure
                      </button>
                    </motion.div>
                  ) : (
                    <>
                      <motion.div variants={itemVariants} className="relative">
                        <div className="absolute -left-6 top-0 bottom-0 w-1.5 bg-gradient-to-b from-aesthetic-lavender via-aesthetic-lavender-deep to-aesthetic-lavender rounded-full opacity-50"></div>
                        <div className="bg-white border border-aesthetic-lavender rounded-[2.5rem] shadow-sm p-12 font-serif italic text-xl leading-loose text-aesthetic-ink/80 whitespace-pre-wrap">
                          {todayPlan}
                        </div>
                      </motion.div>

                      <motion.div variants={itemVariants} className="flex gap-6">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={reset}
                          className="flex-1 py-6 bg-white border border-aesthetic-lavender text-aesthetic-lavender-deep rounded-full font-medium hover:bg-aesthetic-lavender/20 transition-all text-lg"
                        >
                          New Beginning
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => setStep('execute')}
                          className="flex-1 py-6 bg-aesthetic-lavender-deep text-white rounded-full font-medium flex items-center justify-center gap-3 hover:bg-aesthetic-lavender-deep/90 transition-all shadow-lg shadow-aesthetic-lavender-deep/20 text-lg"
                        >
                          Start Execution
                        </motion.button>
                      </motion.div>
                    </>
                  )}
                </motion.div>
              )}

              {step === 'execute' && (
                <motion.div
                  key="execute"
                  variants={containerVariants}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                  className="space-y-10"
                >
                  <motion.div variants={itemVariants} className="space-y-3">
                    <h2 className="text-4xl font-serif italic text-aesthetic-lavender-deep">Execution Mode</h2>
                    <p className="text-aesthetic-ink/60 text-lg font-light">Tick off your tasks as you complete them.</p>
                  </motion.div>

                  {checklist.length > 0 ? (
                    <>
                      <motion.div variants={itemVariants} className="bg-white border border-aesthetic-lavender rounded-[2.5rem] shadow-sm p-12 space-y-6">
                        {checklist.map((item) => (
                          <motion.button
                            layout
                            key={item.id}
                            onClick={() => toggleTask(item.id)}
                            whileHover={{ scale: 1.01, x: 8 }}
                            whileTap={{ scale: 0.99 }}
                            className={cn(
                              "w-full flex items-start gap-6 p-6 rounded-3xl transition-all text-left group",
                              item.completed 
                                ? "bg-aesthetic-lavender/10 opacity-60" 
                                : "hover:bg-aesthetic-bg"
                            )}
                          >
                            <div className={cn(
                              "mt-1.5 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all",
                              item.completed 
                                ? "bg-aesthetic-lavender-deep border-aesthetic-lavender-deep" 
                                : "border-aesthetic-lavender group-hover:border-aesthetic-lavender-deep"
                            )}>
                              {item.completed && <CheckCircle2 className="w-4 h-4 text-white" />}
                            </div>
                            <span className={cn(
                              "text-xl font-serif italic transition-all",
                              item.completed ? "line-through text-aesthetic-ink/40" : "text-aesthetic-ink"
                            )}>
                              {item.text}
                            </span>
                          </motion.button>
                        ))}
                      </motion.div>

                      <motion.div variants={itemVariants} className="flex gap-6">
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={reset}
                          className="flex-1 py-6 bg-white border border-aesthetic-lavender text-aesthetic-lavender-deep rounded-full font-medium hover:bg-aesthetic-lavender/20 transition-all text-lg"
                        >
                          New Beginning
                        </motion.button>
                        <motion.button
                          whileHover={{ scale: 1.02 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={() => window.print()}
                          className="flex-1 py-6 bg-aesthetic-lavender-deep text-white rounded-full font-medium flex items-center justify-center gap-3 hover:bg-aesthetic-lavender-deep/90 transition-all shadow-lg shadow-aesthetic-lavender-deep/20 text-lg"
                        >
                          Save Ritual
                        </motion.button>
                      </motion.div>
                    </>
                  ) : (
                    <motion.div variants={itemVariants} className="bg-white border border-aesthetic-lavender rounded-[2.5rem] p-20 text-center space-y-6">
                      <div className="w-20 h-20 bg-aesthetic-bg rounded-full flex items-center justify-center mx-auto">
                        <CheckCircle2 className="w-10 h-10 text-aesthetic-lavender-deep opacity-30" />
                      </div>
                      <p className="text-aesthetic-ink/40 font-serif italic text-xl">Create a Daily Ritual first to start executing.</p>
                      <button 
                        onClick={() => setStep('plan')}
                        className="px-8 py-4 bg-aesthetic-lavender/20 text-aesthetic-lavender-deep rounded-full font-medium hover:bg-aesthetic-lavender/40 transition-all"
                      >
                        Go to Daily Ritual
                      </button>
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {error && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="mt-12 p-6 bg-red-50/50 border border-red-100 rounded-[2.5rem] flex items-center gap-6 text-red-600 text-lg italic font-serif"
              >
                <AlertCircle className="w-6 h-6 flex-shrink-0" />
                {error}
              </motion.div>
            )}
          </div>
        </main>

        <footer className="h-20 flex items-center justify-center gap-8 text-aesthetic-lavender-deep/30 relative z-10">
          <Moon className="w-4 h-4" />
          <Sun className="w-4 h-4" />
          <Coffee className="w-4 h-4" />
          <p className="text-[10px] text-aesthetic-ink/30 uppercase tracking-[0.4em] font-bold">
            ClearDay Rituals
          </p>
        </footer>
      </div>
    </div>
  );
}

function StepIndicator({ currentStep }: { currentStep: Step }) {
  const steps: Step[] = ['auth', 'dump', 'process', 'plan', 'execute'];
  const visibleSteps = steps.filter(s => s !== 'auth' || currentStep === 'auth');
  
  return (
    <div className="flex items-center gap-3">
      {visibleSteps.map((s, i) => (
        <React.Fragment key={s}>
          <div 
            className={cn(
              "w-2.5 h-2.5 rounded-full transition-all duration-500",
              currentStep === s 
                ? "bg-aesthetic-lavender-deep scale-125 shadow-[0_0_10px_rgba(188,168,209,0.5)]" 
                : "bg-aesthetic-lavender"
            )} 
          />
          {i < visibleSteps.length - 1 && (
            <div className="w-6 h-[1px] bg-aesthetic-lavender" />
          )}
        </React.Fragment>
      ))}
    </div>
  );
}
