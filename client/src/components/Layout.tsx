import { useState } from 'react';
import { Sidebar } from './Sidebar';
import { MobileMenu } from './MobileMenu';

interface LayoutProps {
  children: React.ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden bg-slate-950">
      <Sidebar />
      
      <main className="flex-1 overflow-hidden">
        {/* Mobile Header */}
        <header className="md:hidden bg-slate-900 border-b border-slate-700 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <i className="fas fa-robot text-purple-brand text-xl"></i>
              <span className="text-white font-bold text-lg">Host-Elite</span>
            </div>
            <button
              onClick={() => setMobileMenuOpen(true)}
              className="text-slate-400 hover:text-white"
              data-testid="mobile-menu-button"
            >
              <i className="fas fa-bars text-xl"></i>
            </button>
          </div>
        </header>

        <div className="h-full overflow-y-auto">
          {children}
        </div>
      </main>

      <MobileMenu 
        isOpen={mobileMenuOpen} 
        onClose={() => setMobileMenuOpen(false)} 
      />
    </div>
  );
}
