import { Link } from 'wouter';

interface MobileMenuProps {
  isOpen: boolean;
  onClose: () => void;
}

export function MobileMenu({ isOpen, onClose }: MobileMenuProps) {
  const navItems = [
    { path: '/', icon: 'fas fa-tachometer-alt', label: 'Dashboard', color: 'text-purple-brand' },
    { path: '/deploy', icon: 'fas fa-upload', label: 'Deploy Bot', color: 'text-slate-400' },
    { path: '/logs', icon: 'fas fa-terminal', label: 'Live Logs', color: 'text-slate-400' },
    { path: '/guide', icon: 'fas fa-book', label: 'Deployment Guide', color: 'text-slate-400' },
  ];

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 md:hidden">
      <div className="fixed inset-y-0 left-0 w-64 bg-slate-900 border-r border-slate-700">
        <div className="flex items-center justify-between h-16 px-4 bg-gradient-to-r from-purple-brand to-blue-brand">
          <div className="flex items-center space-x-2">
            <i className="fas fa-robot text-white text-xl"></i>
            <span className="text-white font-bold text-lg">Host-Elite</span>
          </div>
          <button
            onClick={onClose}
            className="text-white"
            data-testid="close-mobile-menu"
          >
            <i className="fas fa-times text-xl"></i>
          </button>
        </div>
        
        <nav className="px-4 py-6 space-y-2">
          {navItems.map((item) => (
            <Link key={item.path} href={item.path}>
              <div
                onClick={onClose}
                className="flex items-center px-3 py-2 text-slate-300 rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
                data-testid={`mobile-nav-${item.label.toLowerCase().replace(' ', '-')}`}
              >
                <i className={`${item.icon} mr-3 ${item.color}`}></i>
                <span>{item.label}</span>
              </div>
            </Link>
          ))}
        </nav>
      </div>
      <div className="absolute inset-0" onClick={onClose}></div>
    </div>
  );
}
