import { ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  icon?: ReactNode;
  children: ReactNode;
  className?: string;
}

const Modal = ({ isOpen, onClose, title, icon, children, className = '' }: ModalProps) => {
  const hasMaxWidth = /\bmax-w-/.test(className);
  const defaultMaxWidth = hasMaxWidth ? '' : 'max-w-lg';

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          <motion.div
            key="backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.dialog
            key="dialog"
            open
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.2 }}
            className={`fixed inset-0 z-50 m-auto w-[95vw] md:w-full ${defaultMaxWidth} max-h-[92vh] overflow-y-auto h-fit bg-[#1a1a24] border border-white/10 rounded-2xl p-6 shadow-2xl ${className}`}
            aria-modal="true"
          >
            {title && (
              <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                {icon}
                {title}
              </h2>
            )}
            {children}
          </motion.dialog>
        </>
      )}
    </AnimatePresence>
  );
};

export default Modal;
