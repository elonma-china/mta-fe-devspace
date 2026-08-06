import { create } from 'zustand';

const useAuthStore = create((set) => ({
  user: null,
  setUser: (user) => set({ user }),

  // Logout function — set by App.js on mount so it can
  // access navigate() and localStorage.
  _logout: null,
  setLogout: (fn) => set({ _logout: fn }),

  logout: () => {
    const fn = useAuthStore.getState()._logout;
    if (fn) fn();
  },
}));

export default useAuthStore;
