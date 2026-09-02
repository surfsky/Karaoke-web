import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

interface ToastProps {
  message: string;
  visible: boolean;
  onClose: () => void;
  duration?: number;
}

export const Toast = ({ message, visible, onClose, duration = 2500 }: ToastProps) => {
  const [show, setShow] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    if (visible) {
      setMounted(true);
      const timer = setTimeout(() => setShow(true), 10);
      return () => clearTimeout(timer);
    } else {
      setShow(false);
      const timer = setTimeout(() => setMounted(false), 300);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  useEffect(() => {
    if (!visible || !mounted) return;
    const timer = setTimeout(onClose, duration);
    return () => clearTimeout(timer);
  }, [visible, mounted, duration, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div
      className={`fixed top-4 left-1/2 -translate-x-1/2 z-[100] px-5 py-2.5 rounded-full shadow-2xl shadow-amber-500/30 font-medium text-sm whitespace-nowrap transition-all duration-300 ease-out ${
        show ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-full'
      } bg-gradient-to-r from-amber-500 to-orange-500 text-white border border-amber-400/50`}
    >
      {message}
    </div>,
    document.body
  );
};
