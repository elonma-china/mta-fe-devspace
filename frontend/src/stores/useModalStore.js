// src/stores/useModalStore.js
import { create } from 'zustand';

/**
 * useModalStore
 * Replaces ModalContext. No Provider wrapper needed.
 *
 * Usage:
 *   const { showModal, hideModal } = useModalStore();
 *   showModal(MyModalComponent, { title: 'Hello' });
 */
const useModalStore = create((set) => ({
  component: null,
  props: {},
  isOpen: false,

  showModal: (component, props = {}) =>
    set({ component, props, isOpen: true }),

  hideModal: () => {
    set((s) => ({ ...s, isOpen: false }));
    // Delay unmounting for closing animation (matches original 300ms)
    setTimeout(() => {
      set({ component: null, props: {}, isOpen: false });
    }, 300);
  },
}));

export default useModalStore;
