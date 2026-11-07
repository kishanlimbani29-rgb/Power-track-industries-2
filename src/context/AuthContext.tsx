import React, { createContext, useContext, useEffect, useState, useMemo, useCallback } from 'react';
import {
  User,
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  sendEmailVerification,
  updateProfile,
  signOut as fbSignOut,
} from 'firebase/auth';
import {
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  collection,
  query,
  getDocs,
  where,
} from 'firebase/firestore';
import { auth, db, googleProvider, handleFirestoreError, OperationType } from '../firebase/config';
import {
  UserRole,
  UserProfile,
  TeamInvite,
  RolePermissions,
  ROLE_PERMISSIONS,
  RoleDefinition,
  DEFAULT_ROLE_DEFINITIONS,
  TradePermissionKey,
} from '../types/inventory';

export const BOOTSTRAP_ADMIN_EMAIL = 'kishanlimbani29@gmail.com';

interface AuthContextType {
  currentUser: User | null;
  profile: UserProfile | null;
  profileError: string | null;
  role: UserRole;
  actualRole: UserRole;
  isEmailVerified: boolean;
  isPendingApproval: boolean;
  isSuspended: boolean;
  isTestingRole: boolean;
  permissions: RolePermissions;
  rolePermissions: Record<UserRole, RolePermissions>;
  customRoles: RoleDefinition[];
  allRoles: RoleDefinition[];
  isLoading: boolean;
  realUserName: string;
  realUserUid: string;
  simulatedName: string;

  // Team & Invites for Admins
  teamMembers: UserProfile[];
  pendingUsers: UserProfile[];
  activeUsers: UserProfile[];
  invites: TeamInvite[];

  // Authentication methods
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, pass: string) => Promise<void>;
  signUpWithEmail: (email: string, pass: string, displayName: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  reloadCurrentUser: () => Promise<void>;
  signOut: () => Promise<void>;
  retryLoadProfile: () => Promise<void>;

  // Simulation & Admin Preview
  switchSimulatedRole: (newRole: UserRole) => void;
  exitSimulatedRole: () => void;

  // User Management
  approvePendingUser: (targetUid: string, assignedRole: UserRole) => Promise<void>;
  rejectPendingUser: (targetUid: string) => Promise<void>;
  updateUserRole: (targetUid: string, newRole: UserRole) => Promise<void>;
  updateUserStatus: (targetUid: string, status: 'active' | 'suspended') => Promise<void>;
  removeTeamMember: (targetUid: string) => Promise<void>;

  // Invites
  createInvite: (email: string, role: UserRole) => Promise<void>;
  deleteInvite: (inviteId: string) => Promise<void>;

  // Role Permissions
  updateRolePermission: (
    targetRole: UserRole,
    permissionKey: keyof RolePermissions,
    allowed: boolean
  ) => Promise<void>;
  setRoleFullPermissions: (
    targetRole: UserRole,
    fullPermissions: RolePermissions
  ) => Promise<void>;
  resetRolePermissions: () => Promise<void>;
  resetSingleRolePermissions: (targetRole: UserRole) => Promise<void>;
  addCustomRole: (newRole: Omit<RoleDefinition, 'isSystem'>) => Promise<void>;
  deleteCustomRole: (roleId: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [emailVerifiedOverride, setEmailVerifiedOverride] = useState<boolean>(false);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [simulatedRole, setSimulatedRole] = useState<UserRole | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Admin-only managed users and invites
  const [teamMembers, setTeamMembers] = useState<UserProfile[]>([]);
  const [invites, setInvites] = useState<TeamInvite[]>([]);

  // Custom roles created dynamically by Admin
  const [customRoles, setCustomRoles] = useState<RoleDefinition[]>(() => {
    try {
      const cached = localStorage.getItem('stodo_custom_roles');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });

  const allRoles: RoleDefinition[] = useMemo(() => {
    return [...DEFAULT_ROLE_DEFINITIONS, ...customRoles];
  }, [customRoles]);

  // Dynamic role permissions configured by Admin, synced with Firestore
  const [rolePermissions, setRolePermissions] = useState<Record<UserRole, RolePermissions>>(() => {
    try {
      const cached = localStorage.getItem('stodo_role_permissions');
      if (cached) {
        const parsed = JSON.parse(cached);
        if (parsed && typeof parsed === 'object') {
          return {
            ...parsed,
            admin: { ...ROLE_PERMISSIONS.admin, ...(parsed.admin || {}) },
            manager: { ...ROLE_PERMISSIONS.manager, ...(parsed.manager || {}) },
            staff: { ...ROLE_PERMISSIONS.staff, ...(parsed.staff || {}) },
            viewer: { ...ROLE_PERMISSIONS.viewer, ...(parsed.viewer || {}) },
          };
        }
      }
    } catch {}
    return ROLE_PERMISSIONS;
  });

  // Ensure default roles_permissions exists in Firestore so rules and app sync
  const ensureDefaultSettings = useCallback(async () => {
    try {
      const settingsRef = doc(db, 'settings', 'roles_permissions');
      const snap = await getDoc(settingsRef);
      if (!snap.exists()) {
        await setDoc(settingsRef, {
          permissions: ROLE_PERMISSIONS,
          customRoles: [],
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (e) {
      console.warn('Settings check warning (rules might restrict if not signed in yet):', e);
    }
  }, []);

  // Listen to Firestore settings/roles_permissions in real time
  // Start this listener only when currentUser exists and the profile is loaded with status 'active'
  useEffect(() => {
    if (!currentUser || !profile || profile.status !== 'active') {
      return;
    }

    const unsub = onSnapshot(
      doc(db, 'settings', 'roles_permissions'),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as {
            permissions?: Record<string, RolePermissions>;
            customRoles?: RoleDefinition[];
          };
          if (data.customRoles && Array.isArray(data.customRoles)) {
            setCustomRoles(data.customRoles);
            try {
              localStorage.setItem('stodo_custom_roles', JSON.stringify(data.customRoles));
            } catch {}
          }
          if (data.permissions) {
            const merged = {
              ...data.permissions,
              admin: { ...ROLE_PERMISSIONS.admin, ...(data.permissions.admin || {}) },
              manager: { ...ROLE_PERMISSIONS.manager, ...(data.permissions.manager || {}) },
              staff: { ...ROLE_PERMISSIONS.staff, ...(data.permissions.staff || {}) },
              viewer: { ...ROLE_PERMISSIONS.viewer, ...(data.permissions.viewer || {}) },
            };
            setRolePermissions(merged);
            try {
              localStorage.setItem('stodo_role_permissions', JSON.stringify(merged));
            } catch {}
          }
        } else {
          // If doc does not exist, seed default switches only if signed-in user is Admin
          if (profile.role === 'admin') {
            ensureDefaultSettings();
          }
        }
      },
      (err) => {
        console.warn('Roles permissions listener:', err.message);
      }
    );
    return () => unsub();
  }, [currentUser, profile, ensureDefaultSettings]);

  // Load profile from Firestore for a given user with automatic retry for transient offline blips
  const syncUserProfile = useCallback(async (user: User, attempt = 1): Promise<void> => {
    setProfileError(null);
    try {
      const userRef = doc(db, 'users', user.uid);
      const userSnap = await getDoc(userRef);

      const isVerified = Boolean(
        user.emailVerified || user.providerData.some((p) => p.providerId === 'google.com')
      );
      const isOwner = Boolean(
        user.email &&
        user.email.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase() &&
        isVerified
      );

      if (userSnap.exists()) {
        const data = userSnap.data() as UserProfile;
        // If owner email is verified, ensure role is admin and status active
        if (isOwner && (data.role !== 'admin' || data.status !== 'active')) {
          await setDoc(userRef, { role: 'admin', status: 'active', updatedAt: new Date().toISOString() }, { merge: true });
          setProfile({ ...data, role: 'admin', status: 'active' });
        } else {
          setProfile(data);
        }
      } else {
        // Profile does not exist yet. Check if owner or invite exists
        let assignedRole: UserRole = 'viewer';
        let assignedStatus: 'active' | 'pending' = 'pending';

        if (isOwner) {
          assignedRole = 'admin';
          assignedStatus = 'active';
        } else if (isVerified && user.email) {
          // Check for pre-authorized invite
          try {
            const inviteRef = doc(db, 'invites', user.email.toLowerCase());
            const inviteSnap = await getDoc(inviteRef);
            if (inviteSnap.exists()) {
              const invData = inviteSnap.data() as TeamInvite;
              // Never accept 'admin' from invite; default to 'staff' if invalid or missing
              assignedRole = (invData.role && invData.role !== 'admin') ? invData.role : 'staff';
              assignedStatus = 'active';
            }
          } catch (invErr) {
            console.warn('Invite check skipped/failed:', invErr);
          }
        }

        const newProfile: UserProfile = {
          uid: user.uid,
          email: user.email || '',
          displayName: user.displayName || user.email?.split('@')[0] || 'Team Member',
          role: assignedRole,
          status: assignedStatus,
          photoURL: user.photoURL || null,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        try {
          await setDoc(userRef, newProfile);
          setProfile(newProfile);
          // If created via invite, consume/delete the invite
          if (assignedStatus === 'active' && !isOwner && user.email) {
            try {
              await deleteDoc(doc(db, 'invites', user.email.toLowerCase()));
            } catch {}
          }
        } catch (createErr) {
          console.warn('Failed to create profile with assigned role, falling back to pending:', createErr);
          // Fall back to creating it as 'pending' so Admin can approve instead of user seeing an error
          const fallbackPendingProfile: UserProfile = {
            ...newProfile,
            role: 'viewer',
            status: 'pending',
          };
          await setDoc(userRef, fallbackPendingProfile);
          setProfile(fallbackPendingProfile);
        }
      }
    } catch (err: any) {
      console.warn('User profile could not be loaded from Firestore:', err?.message || err);
      const isOfflineError = err?.message && (
        err.message.includes('offline') ||
        err.message.includes('Failed to get document') ||
        err.message.includes('network')
      );

      if (isOfflineError && attempt < 2) {
        console.warn(`Profile sync attempt ${attempt} offline, retrying in 1200ms...`);
        await new Promise((r) => setTimeout(r, 1200));
        return syncUserProfile(user, attempt + 1);
      }

      // If the profile can't be loaded, show the error screen for everyone, including the owner.
      setProfileError(err?.message || 'Failed to load user profile. Please check your network connection and try again.');
      setProfile(null);
    }
  }, []);

  // Listen to Auth State strictly via Firebase Authentication
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        setCurrentUser(user);
        setEmailVerifiedOverride(Boolean(
          user.emailVerified || user.providerData.some((p) => p.providerId === 'google.com')
        ));
        await syncUserProfile(user);
      } else {
        // Real signed-out state: NO GUEST FALLBACK PROFILE
        setCurrentUser(null);
        setEmailVerifiedOverride(false);
        setProfile(null);
        setProfileError(null);
        setSimulatedRole(null);
        localStorage.removeItem('stodo_auth_user');
        localStorage.removeItem('stodo_simulated_role');
      }
      setIsLoading(false);
    });

    return () => unsubscribe();
  }, [syncUserProfile]);

  // Real-time listener for current user's profile updates (e.g. when Admin approves them)
  useEffect(() => {
    if (!currentUser) return;
    const unsub = onSnapshot(
      doc(db, 'users', currentUser.uid),
      (snap) => {
        if (snap.exists()) {
          const data = snap.data() as UserProfile;
          setProfile(data);
        }
      },
      (err) => {
        console.warn('User profile realtime listener:', err.message);
      }
    );
    return () => unsub();
  }, [currentUser]);

  // Verification and Status checks
  const isEmailVerified = useMemo(() => {
    if (!currentUser) return false;
    return Boolean(
      emailVerifiedOverride ||
      currentUser.emailVerified ||
      currentUser.providerData.some((p) => p.providerId === 'google.com')
    );
  }, [currentUser, emailVerifiedOverride]);

  const isPendingApproval = useMemo(() => {
    return Boolean(currentUser && profile && profile.status === 'pending');
  }, [currentUser, profile]);

  const isSuspended = useMemo(() => {
    return Boolean(currentUser && profile && profile.status === 'suspended');
  }, [currentUser, profile]);

  const actualRole: UserRole = useMemo(() => {
    return profile?.role || 'viewer';
  }, [profile]);

  // Only actual Admins can test/simulate another role
  const isRealAdmin = useMemo(() => {
    return actualRole === 'admin' && profile?.status === 'active';
  }, [actualRole, profile]);

  // Effective role used for UI capability evaluation
  const effectiveRole: UserRole = useMemo(() => {
    if (isRealAdmin && simulatedRole) {
      return simulatedRole;
    }
    return actualRole;
  }, [isRealAdmin, simulatedRole, actualRole]);

  const isTestingRole = Boolean(isRealAdmin && simulatedRole && simulatedRole !== actualRole);

  // Load Team & Invites ONLY for real Admins
  useEffect(() => {
    if (!currentUser || !isRealAdmin) {
      setTeamMembers([]);
      setInvites([]);
      return;
    }

    // Subscribe to all users
    const usersUnsub = onSnapshot(
      query(collection(db, 'users')),
      (snap) => {
        const list: UserProfile[] = [];
        snap.forEach((d) => {
          const u = d.data() as UserProfile;
          list.push({ ...u, uid: d.id });
        });
        setTeamMembers(list);
      },
      (err) => {
        console.warn('Admin users list listener error:', err.message);
      }
    );

    // Subscribe to all invites
    const invitesUnsub = onSnapshot(
      query(collection(db, 'invites')),
      (snap) => {
        const list: TeamInvite[] = [];
        snap.forEach((d) => {
          list.push({ ...(d.data() as TeamInvite), id: d.id });
        });
        setInvites(list);
      },
      (err) => {
        console.warn('Admin invites listener error:', err.message);
      }
    );

    return () => {
      usersUnsub();
      invitesUnsub();
    };
  }, [currentUser, isRealAdmin]);

  const pendingUsers = useMemo(() => {
    return teamMembers.filter((u) => u.status === 'pending');
  }, [teamMembers]);

  const activeUsers = useMemo(() => {
    return teamMembers.filter((u) => u.status !== 'pending');
  }, [teamMembers]);

  // Derived capability permissions based on effective role
  const permissions = useMemo<RolePermissions>(() => {
    let resolved: RolePermissions | undefined;
    if (rolePermissions && rolePermissions[effectiveRole]) {
      resolved = rolePermissions[effectiveRole];
    } else if (ROLE_PERMISSIONS[effectiveRole as keyof typeof ROLE_PERMISSIONS]) {
      resolved = ROLE_PERMISSIONS[effectiveRole as keyof typeof ROLE_PERMISSIONS];
    } else {
      const foundCustom = customRoles.find((c) => c.id === effectiveRole);
      if (foundCustom) {
        resolved = foundCustom.permissions;
      }
    }

    if (!resolved) {
      resolved = ROLE_PERMISSIONS.viewer;
    }

    const tradeDefault = (key: TradePermissionKey): boolean => {
      const base = ROLE_PERMISSIONS[effectiveRole as keyof typeof ROLE_PERMISSIONS];
      return base ? Boolean(base[key]) : false;
    };

    return {
      canEditItems: resolved.canEditItems ?? false,
      canDeleteItems: resolved.canDeleteItems ?? false,
      canOpenProductDetail: resolved.canOpenProductDetail ?? (effectiveRole !== 'viewer'),
      canEditRecipes: resolved.canEditRecipes ?? false,
      canDeleteRecipes: resolved.canDeleteRecipes ?? false,
      canProduceBatch: resolved.canProduceBatch ?? false,
      canAdjustStock: resolved.canAdjustStock ?? false,
      canViewCostPerUnit: resolved.canViewCostPerUnit ?? (effectiveRole === 'admin' || effectiveRole === 'manager'),
      canViewTotalAssetValue: resolved.canViewTotalAssetValue ?? (effectiveRole === 'admin' || effectiveRole === 'manager'),
      canViewFinances: resolved.canViewFinances ?? false,
      canViewShelfOption: resolved.canViewShelfOption ?? (effectiveRole === 'admin' || effectiveRole === 'manager' || effectiveRole === 'staff'),
      canViewBatchProductionOption: resolved.canViewBatchProductionOption ?? (effectiveRole !== 'viewer'),
      canViewAuditReports: resolved.canViewAuditReports ?? true,
      canViewStockMovementsOption: resolved.canViewStockMovementsOption ?? true,
      canViewRolesAccessOption: resolved.canViewRolesAccessOption ?? (effectiveRole !== 'viewer'),
      canExportExcel: resolved.canExportExcel ?? (effectiveRole !== 'viewer'),
      canSubmitAuditRequests: resolved.canSubmitAuditRequests ?? (effectiveRole !== 'viewer'),
      canAuditRequests: resolved.canAuditRequests ?? (effectiveRole === 'admin' || effectiveRole === 'manager'),
      canManageUsers: resolved.canManageUsers ?? (effectiveRole === 'admin'),
      // Sales & Purchase (missing keys fall back to the role's default)
      canViewSalesOption: resolved.canViewSalesOption ?? tradeDefault('canViewSalesOption'),
      canCreateSales: resolved.canCreateSales ?? tradeDefault('canCreateSales'),
      canEditSales: resolved.canEditSales ?? tradeDefault('canEditSales'),
      canDeleteSales: resolved.canDeleteSales ?? tradeDefault('canDeleteSales'),
      canRecordPayments: resolved.canRecordPayments ?? tradeDefault('canRecordPayments'),
      canCreateSalesReturn: resolved.canCreateSalesReturn ?? tradeDefault('canCreateSalesReturn'),
      canEditSalesReturn: resolved.canEditSalesReturn ?? tradeDefault('canEditSalesReturn'),
      canDeleteSalesReturn: resolved.canDeleteSalesReturn ?? tradeDefault('canDeleteSalesReturn'),
      canViewPurchaseOption: resolved.canViewPurchaseOption ?? tradeDefault('canViewPurchaseOption'),
      canCreatePurchase: resolved.canCreatePurchase ?? tradeDefault('canCreatePurchase'),
      canEditPurchase: resolved.canEditPurchase ?? tradeDefault('canEditPurchase'),
      canDeletePurchase: resolved.canDeletePurchase ?? tradeDefault('canDeletePurchase'),
      canReceivePurchase: resolved.canReceivePurchase ?? tradeDefault('canReceivePurchase'),
      canRecordPurchasePayments: resolved.canRecordPurchasePayments ?? tradeDefault('canRecordPurchasePayments'),
      canCreatePurchaseReturn: resolved.canCreatePurchaseReturn ?? tradeDefault('canCreatePurchaseReturn'),
      canEditPurchaseReturn: resolved.canEditPurchaseReturn ?? tradeDefault('canEditPurchaseReturn'),
      canDeletePurchaseReturn: resolved.canDeletePurchaseReturn ?? tradeDefault('canDeletePurchaseReturn'),
    };
  }, [rolePermissions, effectiveRole, customRoles]);

  // Real logged-in user identification
  const realUserName = useMemo(() => {
    if (currentUser?.displayName) return currentUser.displayName;
    if (profile?.displayName) return profile.displayName;
    if (currentUser?.email) return currentUser.email.split('@')[0];
    return 'User';
  }, [currentUser, profile]);

  const realUserUid = currentUser?.uid || '';

  // Real Firebase Authentication methods (no fallbacks or password hashing)
  const signInWithGoogle = async () => {
    setIsLoading(true);
    setProfileError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err: any) {
      console.warn('Google Sign-in error:', err?.message || err);
      if (err?.code === 'auth/network-request-failed' || err?.message?.includes('network-request-failed')) {
        throw new Error('No internet connection, please try again.');
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const signInWithEmail = async (email: string, pass: string) => {
    setIsLoading(true);
    setProfileError(null);
    const cleanEmail = email.trim().toLowerCase();

    try {
      await signInWithEmailAndPassword(auth, cleanEmail, pass);
    } catch (authErr: any) {
      console.warn('Email Sign-in error:', authErr?.message || authErr);
      if (authErr?.code === 'auth/network-request-failed' || authErr?.message?.includes('network-request-failed')) {
        throw new Error('No internet connection, please try again.');
      }
      throw authErr;
    } finally {
      setIsLoading(false);
    }
  };

  const signUpWithEmail = async (email: string, pass: string, displayName: string) => {
    setIsLoading(true);
    setProfileError(null);
    const cleanEmail = email.trim().toLowerCase();

    try {
      const res = await createUserWithEmailAndPassword(auth, cleanEmail, pass);
      if (displayName.trim()) {
        await updateProfile(res.user, { displayName: displayName.trim() });
      }
      try {
        await sendEmailVerification(res.user);
      } catch (verErr) {
        console.warn('Failed to send email verification:', verErr);
      }
    } catch (authErr: any) {
      console.warn('Email Sign-up error:', authErr?.message || authErr);
      if (authErr?.code === 'auth/network-request-failed' || authErr?.message?.includes('network-request-failed')) {
        throw new Error('No internet connection, please try again.');
      }
      throw authErr;
    } finally {
      setIsLoading(false);
    }
  };

  const sendPasswordReset = async (email: string) => {
    if (!email.trim()) throw new Error('Please enter your email address.');
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch {
      console.log('Password reset requested for:', email);
    }
  };

  const resendVerificationEmail = async () => {
    if (!currentUser) throw new Error('No user is currently signed in.');
    try {
      await sendEmailVerification(currentUser);
    } catch {}
  };

  const reloadCurrentUser = async () => {
    if (!auth.currentUser) return;
    try {
      await auth.currentUser.reload();
      const refreshed = auth.currentUser;
      const verified = Boolean(
        refreshed.emailVerified ||
        refreshed.providerData.some((p) => p.providerId === 'google.com')
      );
      if (verified) {
        setEmailVerifiedOverride(true);
      }
      setCurrentUser(refreshed);
      await syncUserProfile(refreshed);
    } catch (err) {
      console.warn('reloadCurrentUser failed:', err);
      if (auth.currentUser) {
        await syncUserProfile(auth.currentUser);
      }
    }
  };

  const signOut = async () => {
    try {
      await fbSignOut(auth);
    } catch {}
    localStorage.removeItem('stodo_auth_user');
    localStorage.removeItem('stodo_simulated_role');
    setCurrentUser(null);
    setEmailVerifiedOverride(false);
    setProfile(null);
    setProfileError(null);
    setSimulatedRole(null);
  };

  // One-time cleanup for old fallback artifacts
  useEffect(() => {
    if (!currentUser || !isRealAdmin) return;
    const cleanupKey = 'powertrack_cleanup_fallback_v1';
    if (sessionStorage.getItem(cleanupKey)) return;

    const runCleanup = async () => {
      try {
        const usersSnap = await getDocs(collection(db, 'users'));
        for (const uDoc of usersSnap.docs) {
          const uId = uDoc.id;
          const uData = uDoc.data();

          // Delete synthetic fallback documents
          if (uId === 'admin_kishanlimbani' || uId.startsWith('usr_')) {
            try {
              await deleteDoc(doc(db, 'users', uId));
              console.log(`[Cleanup] Deleted legacy fallback user document: ${uId}`);
            } catch (delErr) {
              console.warn(`[Cleanup] Could not delete ${uId}:`, delErr);
            }
          } else if ('passwordHash' in uData) {
            // Remove passwordHash field from real user document
            try {
              const { passwordHash: _, ...cleanData } = uData;
              await setDoc(doc(db, 'users', uId), cleanData);
              console.log(`[Cleanup] Removed passwordHash from user document: ${uId}`);
            } catch (updateErr) {
              console.warn(`[Cleanup] Could not remove passwordHash from ${uId}:`, updateErr);
            }
          }
        }
        localStorage.removeItem('stodo_auth_user');
        sessionStorage.setItem(cleanupKey, 'done');
      } catch (err) {
        console.warn('[Cleanup] Error running one-time users cleanup:', err);
      }
    };

    runCleanup();
  }, [currentUser, isRealAdmin]);


  const retryLoadProfile = async () => {
    if (currentUser) {
      setIsLoading(true);
      try {
        await currentUser.getIdToken(true);
      } catch (tokenErr) {
        console.warn('Could not force-refresh auth token:', tokenErr);
      }
      await syncUserProfile(currentUser);
      setIsLoading(false);
    }
  };

  // Preview / Simulation
  const switchSimulatedRole = (newRole: UserRole) => {
    if (!isRealAdmin) {
      console.warn('Only administrators can test as another role.');
      return;
    }
    setSimulatedRole(newRole);
    localStorage.setItem('stodo_simulated_role', newRole);
  };

  const exitSimulatedRole = () => {
    setSimulatedRole(null);
    localStorage.removeItem('stodo_simulated_role');
  };

  // Team Management (Admin Only)
  const approvePendingUser = async (targetUid: string, assignedRole: UserRole) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators can approve user registrations.');
    }
    const path = `users/${targetUid}`;
    try {
      await setDoc(
        doc(db, 'users', targetUid),
        { role: assignedRole, status: 'active', updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const rejectPendingUser = async (targetUid: string) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators can reject user registrations.');
    }
    const path = `users/${targetUid}`;
    try {
      await deleteDoc(doc(db, 'users', targetUid));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const updateUserRole = async (targetUid: string, newRole: UserRole) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to assign user roles.');
    }
    const path = `users/${targetUid}`;
    try {
      await setDoc(
        doc(db, 'users', targetUid),
        { role: newRole, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const updateUserStatus = async (targetUid: string, status: 'active' | 'suspended') => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to update user status.');
    }
    const path = `users/${targetUid}`;
    try {
      await setDoc(
        doc(db, 'users', targetUid),
        { status, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  };

  const removeTeamMember = async (targetUid: string) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to remove team members.');
    }
    if (targetUid === currentUser?.uid) {
      throw new Error('You cannot remove your own active administrator account.');
    }
    const path = `users/${targetUid}`;
    try {
      await deleteDoc(doc(db, 'users', targetUid));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  // Team Invites
  const createInvite = async (email: string, role?: UserRole) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators can invite new members.');
    }
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      throw new Error('Please enter a valid email address.');
    }

    // Never offer or assign 'admin' role via invites; always save a role on the invite (default to staff)
    const finalRole: UserRole = (role && role !== 'admin') ? role : 'staff';

    const inviteData: TeamInvite = {
      id: cleanEmail,
      email: cleanEmail,
      role: finalRole,
      invitedBy: currentUser?.uid || '',
      invitedByName: realUserName,
      createdAt: new Date().toISOString(),
    };

    const path = `invites/${cleanEmail}`;
    try {
      await setDoc(doc(db, 'invites', cleanEmail), inviteData);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  };

  const deleteInvite = async (inviteId: string) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators can cancel invites.');
    }
    const path = `invites/${inviteId}`;
    try {
      await deleteDoc(doc(db, 'invites', inviteId));
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  // Role Permissions Configuration
  const updateRolePermission = async (
    targetRole: UserRole,
    permissionKey: keyof RolePermissions,
    allowed: boolean
  ) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to modify role access rights.');
    }

    const currentTargetPerms =
      rolePermissions[targetRole] ||
      ROLE_PERMISSIONS[targetRole as keyof typeof ROLE_PERMISSIONS] ||
      ROLE_PERMISSIONS.viewer;

    const updatedRolePerms: Record<UserRole, RolePermissions> = {
      ...rolePermissions,
      [targetRole]: {
        ...currentTargetPerms,
        [permissionKey]: allowed,
      },
    };

    setRolePermissions(updatedRolePerms);
    try {
      localStorage.setItem('stodo_role_permissions', JSON.stringify(updatedRolePerms));
    } catch {}

    try {
      await setDoc(
        doc(db, 'settings', 'roles_permissions'),
        { permissions: updatedRolePerms, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to sync permissions to Firestore:', err);
    }
  };

  // FIXED: Single write for entire permission set (Fixes Grant All / Revoke All bug)
  const setRoleFullPermissions = async (
    targetRole: UserRole,
    fullPermissions: RolePermissions
  ) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to modify role access rights.');
    }

    const updatedRolePerms: Record<UserRole, RolePermissions> = {
      ...rolePermissions,
      [targetRole]: fullPermissions,
    };

    setRolePermissions(updatedRolePerms);
    try {
      localStorage.setItem('stodo_role_permissions', JSON.stringify(updatedRolePerms));
    } catch {}

    try {
      await setDoc(
        doc(db, 'settings', 'roles_permissions'),
        { permissions: updatedRolePerms, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (err) {
      console.error('Failed to sync full role permissions to Firestore:', err);
      throw err;
    }
  };

  const resetRolePermissions = async () => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to reset access rights.');
    }

    setRolePermissions(ROLE_PERMISSIONS);
    try {
      localStorage.setItem('stodo_role_permissions', JSON.stringify(ROLE_PERMISSIONS));
    } catch {}

    try {
      await setDoc(
        doc(db, 'settings', 'roles_permissions'),
        { permissions: ROLE_PERMISSIONS, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to reset permissions in Firestore:', err);
    }
  };

  const resetSingleRolePermissions = async (targetRole: UserRole) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to reset access rights.');
    }

    const defaultPerms = ROLE_PERMISSIONS[targetRole as keyof typeof ROLE_PERMISSIONS];
    if (!defaultPerms) return;

    await setRoleFullPermissions(targetRole, defaultPerms);
  };

  const addCustomRole = async (newRole: Omit<RoleDefinition, 'isSystem'>) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to create new roles.');
    }

    const roleId = newRole.id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    if (!roleId) throw new Error('Role identifier cannot be empty');

    if (allRoles.some((r) => r.id === roleId)) {
      throw new Error(`Role with identifier "${roleId}" already exists.`);
    }

    const roleDef: RoleDefinition = {
      ...newRole,
      id: roleId,
      isSystem: false,
    };

    const updatedCustomRoles = [...customRoles, roleDef];
    const updatedRolePerms: Record<string, RolePermissions> = {
      ...rolePermissions,
      [roleId]: roleDef.permissions,
    };

    setCustomRoles(updatedCustomRoles);
    setRolePermissions(updatedRolePerms as Record<UserRole, RolePermissions>);

    try {
      localStorage.setItem('stodo_custom_roles', JSON.stringify(updatedCustomRoles));
      localStorage.setItem('stodo_role_permissions', JSON.stringify(updatedRolePerms));
    } catch {}

    try {
      await setDoc(
        doc(db, 'settings', 'roles_permissions'),
        {
          permissions: updatedRolePerms,
          customRoles: updatedCustomRoles,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to save custom role to Firestore:', err);
    }
  };

  const deleteCustomRole = async (roleId: string) => {
    if (!isRealAdmin) {
      throw new Error('Only administrators have authority to delete custom roles.');
    }
    if (['admin', 'manager', 'staff', 'viewer'].includes(roleId)) {
      throw new Error('Built-in system roles cannot be deleted.');
    }

    const updatedCustomRoles = customRoles.filter((r) => r.id !== roleId);
    const updatedRolePerms = { ...rolePermissions };
    delete updatedRolePerms[roleId];

    setCustomRoles(updatedCustomRoles);
    setRolePermissions(updatedRolePerms);

    if (simulatedRole === roleId) {
      setSimulatedRole(null);
      localStorage.removeItem('stodo_simulated_role');
    }

    try {
      localStorage.setItem('stodo_custom_roles', JSON.stringify(updatedCustomRoles));
      localStorage.setItem('stodo_role_permissions', JSON.stringify(updatedRolePerms));
    } catch {}

    try {
      await setDoc(
        doc(db, 'settings', 'roles_permissions'),
        {
          permissions: updatedRolePerms,
          customRoles: updatedCustomRoles,
          updatedAt: new Date().toISOString(),
        },
        { merge: true }
      );
    } catch (err) {
      console.warn('Failed to delete custom role from Firestore:', err);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        currentUser,
        profile,
        profileError,
        role: effectiveRole,
        actualRole,
        isEmailVerified,
        isPendingApproval,
        isSuspended,
        isTestingRole,
        permissions,
        rolePermissions,
        customRoles,
        allRoles,
        isLoading,
        realUserName,
        realUserUid,
        simulatedName: realUserName,
        teamMembers,
        pendingUsers,
        activeUsers,
        invites,
        signInWithGoogle,
        signInWithEmail,
        signUpWithEmail,
        sendPasswordReset,
        resendVerificationEmail,
        reloadCurrentUser,
        signOut,
        retryLoadProfile,
        switchSimulatedRole,
        exitSimulatedRole,
        approvePendingUser,
        rejectPendingUser,
        updateUserRole,
        updateUserStatus,
        removeTeamMember,
        createInvite,
        deleteInvite,
        updateRolePermission,
        setRoleFullPermissions,
        resetRolePermissions,
        resetSingleRolePermissions,
        addCustomRole,
        deleteCustomRole,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
