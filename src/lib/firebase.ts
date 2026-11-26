import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocFromServer,
  getFirestore,
  initializeFirestore,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';
import firebaseConfig from '../../firebase-applet-config.json';
import { GOOGLE_WORKSPACE_SCOPES } from './googleWorkspace';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleAuthProvider = new GoogleAuthProvider();
googleAuthProvider.setCustomParameters({ prompt: 'select_account' });

export const googleWorkspaceAuthProvider = new GoogleAuthProvider();
googleWorkspaceAuthProvider.setCustomParameters({
  prompt: 'select_account',
  include_granted_scopes: 'true',
});
for (const scope of GOOGLE_WORKSPACE_SCOPES) {
  googleWorkspaceAuthProvider.addScope(scope);
}

const configuredDatabaseId = (
  firebaseConfig as { firestoreDatabaseId?: string }
).firestoreDatabaseId?.trim();

function createResilientFirestore(): Firestore {
  try {
    return configuredDatabaseId
      ? initializeFirestore(
          app,
          { experimentalForceLongPolling: true },
          configuredDatabaseId
        )
      : initializeFirestore(app, { experimentalForceLongPolling: true });
  } catch {
    return configuredDatabaseId
      ? getFirestore(app, configuredDatabaseId)
      : getFirestore(app);
  }
}

export const db = createResilientFirestore();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export interface UserWorkspacePrefs {
  defaultWorkflowMode: 'single_polish' | 'multi_merge' | 'master_update' | 'raw_synthesis';
  defaultAiModel: 'gemini-4-hydrogen' | 'gemini-3.8-flash';
  defaultThinkingLevel: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH' | 'XHIGH';
  defaultFontFamily: string;
  defaultPageSize: 'A4' | 'B5';
  googleSearchMode: 'off' | 'conflicts_only' | 'conflicts_and_enrichment';
}

export interface FirestoreProjectLiveState {
  ownerId: string;
  projectId: string;
  title: string;
  workflowMode: 'single_polish' | 'multi_merge' | 'master_update' | 'raw_synthesis';
  stage: number;
  percent: number;
  status: 'draft' | 'running' | 'paused' | 'awaiting_outline' | 'completed' | 'failed';
  stageMessage: string;
  activeFileName: string;
  processedCount: number;
  totalCount: number;
  paused: boolean;
}

export interface FirestoreChatMessage {
  id: string;
  ownerId: string;
  projectId: string;
  role: 'user' | 'assistant';
  source: 'text' | 'voice';
  text: string;
  hasProposal: boolean;
  proposalApplied: boolean;
  proposalSummary: string;
  createdAtMs?: number;
}

export const DEFAULT_USER_PREFS: UserWorkspacePrefs = {
  defaultWorkflowMode: 'multi_merge',
  defaultAiModel: 'gemini-4-hydrogen',
  defaultThinkingLevel: 'HIGH',
  defaultFontFamily: 'Vazir Medium',
  defaultPageSize: 'A4',
  googleSearchMode: 'conflicts_only',
};

function sanitizeStr(val: string, maxLen: number): string {
  return (val || '').trim().slice(0, maxLen);
}

export async function ensureUserWorkspaceProfile(params: {
  uid: string;
  displayName: string;
  email: string;
}): Promise<UserWorkspacePrefs> {
  const path = `users/${params.uid}`;
  const ref = doc(db, 'users', params.uid);
  try {
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const data = snap.data();
      return {
        defaultWorkflowMode: data.defaultWorkflowMode || DEFAULT_USER_PREFS.defaultWorkflowMode,
        defaultAiModel: data.defaultAiModel || DEFAULT_USER_PREFS.defaultAiModel,
        defaultThinkingLevel: data.defaultThinkingLevel || DEFAULT_USER_PREFS.defaultThinkingLevel,
        defaultFontFamily: data.defaultFontFamily || DEFAULT_USER_PREFS.defaultFontFamily,
        defaultPageSize: data.defaultPageSize || DEFAULT_USER_PREFS.defaultPageSize,
        googleSearchMode: data.googleSearchMode || DEFAULT_USER_PREFS.googleSearchMode,
      };
    }

    await setDoc(ref, {
      ownerId: params.uid,
      displayName: sanitizeStr(params.displayName || 'کاربر استودیو', 120),
      email: sanitizeStr(params.email || '', 200),
      ...DEFAULT_USER_PREFS,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return DEFAULT_USER_PREFS;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function saveUserWorkspacePrefs(
  uid: string,
  prefs: Partial<UserWorkspacePrefs>
): Promise<void> {
  const path = `users/${uid}`;
  try {
    const ref = doc(db, 'users', uid);
    const updatePayload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
    };
    if (prefs.defaultWorkflowMode) updatePayload.defaultWorkflowMode = prefs.defaultWorkflowMode;
    if (prefs.defaultAiModel) updatePayload.defaultAiModel = prefs.defaultAiModel;
    if (prefs.defaultThinkingLevel) updatePayload.defaultThinkingLevel = prefs.defaultThinkingLevel;
    if (prefs.defaultFontFamily) {
      updatePayload.defaultFontFamily = sanitizeStr(prefs.defaultFontFamily, 64) || 'Vazir Medium';
    }
    if (prefs.defaultPageSize) updatePayload.defaultPageSize = prefs.defaultPageSize;
    if (prefs.googleSearchMode) updatePayload.googleSearchMode = prefs.googleSearchMode;
    await updateDoc(ref, updatePayload);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function upsertProjectLiveState(
  uid: string,
  projectId: string,
  state: Omit<FirestoreProjectLiveState, 'ownerId' | 'projectId'>
): Promise<void> {
  const path = `users/${uid}/projectStates/${projectId}`;
  const ref = doc(db, 'users', uid, 'projectStates', projectId);
  try {
    const existing = await getDoc(ref);
    const payload = {
      title: sanitizeStr(state.title || 'پروژه جدید', 200) || 'پروژه جدید',
      workflowMode: state.workflowMode,
      stage: Math.max(1, Math.min(5, Math.round(state.stage))),
      percent: Math.max(0, Math.min(100, Math.round(state.percent))),
      status: state.status,
      stageMessage: sanitizeStr(state.stageMessage, 300),
      activeFileName: sanitizeStr(state.activeFileName, 240),
      processedCount: Math.max(0, Math.min(10000, Math.round(state.processedCount))),
      totalCount: Math.max(0, Math.min(10000, Math.round(state.totalCount))),
      paused: Boolean(state.paused),
      updatedAt: serverTimestamp(),
    };

    if (!existing.exists()) {
      await setDoc(ref, {
        ownerId: uid,
        projectId,
        ...payload,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(ref, payload);
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export function subscribeProjectLiveState(
  uid: string,
  projectId: string,
  onData: (state: FirestoreProjectLiveState | null) => void
): () => void {
  const path = `users/${uid}/projectStates/${projectId}`;
  const ref = doc(db, 'users', uid, 'projectStates', projectId);
  return onSnapshot(
    ref,
    (snap) => {
      if (!snap.exists()) {
        onData(null);
        return;
      }
      const d = snap.data();
      onData({
        ownerId: d.ownerId,
        projectId: d.projectId,
        title: d.title,
        workflowMode: d.workflowMode,
        stage: d.stage,
        percent: d.percent,
        status: d.status,
        stageMessage: d.stageMessage || '',
        activeFileName: d.activeFileName || '',
        processedCount: d.processedCount ?? 0,
        totalCount: d.totalCount ?? 0,
        paused: Boolean(d.paused),
      });
    },
    (error) => {
      handleFirestoreError(error, OperationType.GET, path);
    }
  );
}

export async function addProjectChatMessage(
  uid: string,
  projectId: string,
  msg: {
    id: string;
    role: 'user' | 'assistant';
    source: 'text' | 'voice';
    text: string;
    hasProposal?: boolean;
    proposalSummary?: string;
  }
): Promise<void> {
  const path = `users/${uid}/projectStates/${projectId}/chatMessages/${msg.id}`;
  const ref = doc(db, 'users', uid, 'projectStates', projectId, 'chatMessages', msg.id);
  try {
    await setDoc(ref, {
      ownerId: uid,
      projectId,
      role: msg.role,
      source: msg.source,
      text: sanitizeStr(msg.text, 8000) || '...',
      hasProposal: Boolean(msg.hasProposal),
      proposalApplied: false,
      proposalSummary: sanitizeStr(msg.proposalSummary || '', 600),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function markChatProposalApplied(
  uid: string,
  projectId: string,
  messageId: string
): Promise<void> {
  const path = `users/${uid}/projectStates/${projectId}/chatMessages/${messageId}`;
  const ref = doc(db, 'users', uid, 'projectStates', projectId, 'chatMessages', messageId);
  try {
    await updateDoc(ref, {
      proposalApplied: true,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export function subscribeProjectChatMessages(
  uid: string,
  projectId: string,
  onData: (messages: FirestoreChatMessage[]) => void
): () => void {
  const path = `users/${uid}/projectStates/${projectId}/chatMessages`;
  const q = query(
    collection(db, 'users', uid, 'projectStates', projectId, 'chatMessages'),
    where('ownerId', '==', uid),
    orderBy('createdAt', 'asc')
  );
  return onSnapshot(
    q,
    (snap) => {
      const list: FirestoreChatMessage[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          ownerId: data.ownerId,
          projectId: data.projectId,
          role: data.role,
          source: data.source || 'text',
          text: data.text,
          hasProposal: Boolean(data.hasProposal),
          proposalApplied: Boolean(data.proposalApplied),
          proposalSummary: data.proposalSummary || '',
          createdAtMs: data.createdAt?.toMillis?.() ?? Date.now(),
        };
      });
      onData(list);
    },
    (error) => {
      handleFirestoreError(error, OperationType.LIST, path);
    }
  );
}

export async function deleteProjectLiveState(uid: string, projectId: string): Promise<void> {
  const path = `users/${uid}/projectStates/${projectId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'projectStates', projectId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}
