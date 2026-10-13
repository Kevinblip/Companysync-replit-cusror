// Inspired by react-hot-toast library
import { useState, useEffect } from "react";

const TOAST_LIMIT = 20;
const TOAST_REMOVE_DELAY = 300; // ms after dismiss animation before removing from DOM

// Default auto-dismiss durations by variant
const DEFAULT_DURATION = 5000;
const DURATION_BY_VARIANT = {
  default: 5000,
  destructive: 8000,
  success: 4000,
};

// Max identical messages shown at once (deduplication cap)
const TOAST_DEDUPE_LIMIT = 3;

const actionTypes = {
  ADD_TOAST: "ADD_TOAST",
  UPDATE_TOAST: "UPDATE_TOAST",
  DISMISS_TOAST: "DISMISS_TOAST",
  REMOVE_TOAST: "REMOVE_TOAST",
};

let count = 0;

function genId() {
  count = (count + 1) % Number.MAX_VALUE;
  return count.toString();
}

const toastTimeouts = new Map();

const addToRemoveQueue = (toastId) => {
  if (toastTimeouts.has(toastId)) {
    return;
  }

  const timeout = setTimeout(() => {
    toastTimeouts.delete(toastId);
    dispatch({
      type: actionTypes.REMOVE_TOAST,
      toastId,
    });
  }, TOAST_REMOVE_DELAY);

  toastTimeouts.set(toastId, timeout);
};

const _clearFromRemoveQueue = (toastId) => {
  const timeout = toastTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    toastTimeouts.delete(toastId);
  }
};

// Auto-dismiss timeouts (separate from remove-queue timeouts)
const dismissTimeouts = new Map();

const scheduleDismiss = (toastId, duration) => {
  if (dismissTimeouts.has(toastId)) {
    clearTimeout(dismissTimeouts.get(toastId));
  }
  const timeout = setTimeout(() => {
    dismissTimeouts.delete(toastId);
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId });
  }, duration);
  dismissTimeouts.set(toastId, timeout);
};

const cancelDismiss = (toastId) => {
  const timeout = dismissTimeouts.get(toastId);
  if (timeout) {
    clearTimeout(timeout);
    dismissTimeouts.delete(toastId);
  }
};

export const reducer = (state, action) => {
  switch (action.type) {
    case actionTypes.ADD_TOAST: {
      const newToast = action.toast;
      // Deduplicate: cap same-description toasts at TOAST_DEDUPE_LIMIT
      const sameMsg = state.toasts.filter(
        (t) => t.description === newToast.description && t.title === newToast.title
      );
      let toasts = [newToast, ...state.toasts].slice(0, TOAST_LIMIT);
      if (sameMsg.length >= TOAST_DEDUPE_LIMIT) {
        // Remove the oldest duplicate to make room
        const oldestDupe = sameMsg[sameMsg.length - 1];
        toasts = toasts.filter((t) => t.id !== oldestDupe.id);
        cancelDismiss(oldestDupe.id);
        addToRemoveQueue(oldestDupe.id);
      }
      return { ...state, toasts };
    }

    case actionTypes.UPDATE_TOAST:
      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === action.toast.id ? { ...t, ...action.toast } : t
        ),
      };

    case actionTypes.DISMISS_TOAST: {
      const { toastId } = action;

      // ! Side effects ! - This could be extracted into a dismissToast() action,
      // but I'll keep it here for simplicity
      if (toastId) {
        addToRemoveQueue(toastId);
      } else {
        state.toasts.forEach((toast) => {
          addToRemoveQueue(toast.id);
        });
      }

      return {
        ...state,
        toasts: state.toasts.map((t) =>
          t.id === toastId || toastId === undefined
            ? {
                ...t,
                open: false,
              }
            : t
        ),
      };
    }
    case actionTypes.REMOVE_TOAST:
      if (action.toastId === undefined) {
        return {
          ...state,
          toasts: [],
        };
      }
      return {
        ...state,
        toasts: state.toasts.filter((t) => t.id !== action.toastId),
      };
  }
};

const listeners = [];

let memoryState = { toasts: [] };

function dispatch(action) {
  memoryState = reducer(memoryState, action);
  listeners.forEach((listener) => {
    listener(memoryState);
  });
}

function toast({ ...props }) {
  const id = genId();

  const update = (props) =>
    dispatch({
      type: actionTypes.UPDATE_TOAST,
      toast: { ...props, id },
    });

  const dismiss = () => {
    cancelDismiss(id);
    dispatch({ type: actionTypes.DISMISS_TOAST, toastId: id });
  };

  dispatch({
    type: actionTypes.ADD_TOAST,
    toast: {
      ...props,
      id,
      open: true,
      onOpenChange: (open) => {
        if (!open) dismiss();
      },
    },
  });

  // Schedule auto-dismiss
  const duration =
    props.duration !== undefined
      ? props.duration
      : (DURATION_BY_VARIANT[props.variant] ?? DEFAULT_DURATION);

  if (duration > 0) {
    scheduleDismiss(id, duration);
  }

  return {
    id,
    dismiss,
    update,
  };
}

function useToast() {
  const [state, setState] = useState(memoryState);

  useEffect(() => {
    listeners.push(setState);
    return () => {
      const index = listeners.indexOf(setState);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    };
  }, [state]);

  return {
    ...state,
    toast,
    dismiss: (toastId) => {
      if (toastId) cancelDismiss(toastId);
      dispatch({ type: actionTypes.DISMISS_TOAST, toastId });
    },
  };
}

export { useToast, toast };
