import React, { createContext, useState, useContext, useEffect, useRef, useCallback, useMemo } from 'react';
import { base44 } from '@/api/base44Client';

const AuthContext = createContext();

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isLoadingAuth, setIsLoadingAuth] = useState(true);
  const [isLoadingPublicSettings] = useState(false);
  const [authError, setAuthError] = useState(null);
  const [appPublicSettings] = useState({ id: 'local', public_settings: {} });
  const hasInitialized = useRef(false);
  const currentUserRef = useRef(null);

  const checkUserAuth = useCallback(async () => {
    try {
      if (!hasInitialized.current) {
        setIsLoadingAuth(true);
      }
      setAuthError(null);
      const currentUser = await base44.auth.me();
      if (currentUser && currentUser.email) {
        const prev = currentUserRef.current;
        const changed = !prev ||
          prev.email !== currentUser.email ||
          prev.platform_role !== currentUser.platform_role ||
          prev.full_name !== currentUser.full_name ||
          prev.name !== currentUser.name;
        if (changed) {
          currentUserRef.current = currentUser;
          setUser(currentUser);
        }
        setIsAuthenticated(true);
      } else {
        if (currentUserRef.current !== null) {
          currentUserRef.current = null;
          setUser(null);
        }
        setIsAuthenticated(false);
      }
    } catch (error) {
      console.error('User auth check failed:', error);
      setIsAuthenticated(false);
      if (currentUserRef.current !== null) {
        currentUserRef.current = null;
        setUser(null);
      }
    } finally {
      hasInitialized.current = true;
      setIsLoadingAuth(false);
    }
  }, []);

  useEffect(() => {
    checkUserAuth();
  }, [checkUserAuth]);

  const checkAppState = useCallback(async () => {
    await checkUserAuth();
  }, [checkUserAuth]);

  const logout = useCallback((shouldRedirect = true) => {
    currentUserRef.current = null;
    setUser(null);
    setIsAuthenticated(false);
    sessionStorage.clear();
    localStorage.removeItem('base44_user_email');
    localStorage.removeItem('last_used_company_id');
    localStorage.removeItem('selected_company_id');
    localStorage.removeItem('cachedSidebar');
    if (shouldRedirect) {
      window.location.href = '/api/logout';
    }
  }, []);

  const navigateToLogin = useCallback(() => {
    window.location.href = '/api/login';
  }, []);

  const contextValue = useMemo(() => ({
    user,
    isAuthenticated,
    isLoadingAuth,
    isLoadingPublicSettings,
    authError,
    appPublicSettings,
    logout,
    navigateToLogin,
    checkAppState,
  }), [user, isAuthenticated, isLoadingAuth, isLoadingPublicSettings, authError, appPublicSettings, logout, navigateToLogin, checkAppState]);

  return (
    <AuthContext.Provider value={contextValue}>
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
