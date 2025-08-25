import { Link, useLocation } from 'wouter';

export function Sidebar() {
  const [location] = useLocation();

  const navItems = [
    { path: '/', icon: 'fas fa-tachometer-alt', label: 'Dashboard', gradient: 'from-purple-500 to-purple-600' },
    { path: '/deploy', icon: 'fas fa-upload', label: 'Deploy Bot', gradient: 'from-blue-500 to-cyan-500' },
    { path: '/logs', icon: 'fas fa-terminal', label: 'Live Logs', gradient: 'from-green-500 to-emerald-500' },
    { path: '/guide', icon: 'fas fa-book', label: 'Deployment Guide', gradient: 'from-amber-500 to-orange-500' },
  ];

  return (
    <aside className="hidden md:flex md:flex-col md:w-64 bg-slate-900/95 border-r border-slate-700/50 backdrop-blur-sm">
      <div className="relative h-16 bg-gradient-to-r from-purple-brand via-purple-500 to-blue-brand overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent animate-pulse"></div>
        <div className="relative flex items-center justify-center h-full">
          <div className="flex items-center space-x-3 group">
            <div className="p-2 bg-white/10 rounded-lg backdrop-blur-sm group-hover:bg-white/20 transition-colors">
              <i className="fas fa-robot text-white text-xl group-hover:animate-bounce"></i>
            </div>
            <span className="text-white font-bold text-lg tracking-wide">Host-Elite</span>
          </div>
        </div>
      </div>
      
      <nav className="flex-1 px-4 py-6 space-y-3">
        {navItems.map((item) => {
          const isActive = location === item.path;
          return (
            <Link key={item.path} href={item.path}>
              <div
                className={`relative flex items-center px-4 py-3 text-slate-300 rounded-xl transition-all duration-300 group cursor-pointer overflow-hidden ${
                  isActive 
                    ? `bg-gradient-to-r ${item.gradient} text-white shadow-lg shadow-purple-500/25` 
                    : 'hover:bg-slate-800/60 hover:scale-105 hover:shadow-md'
                }`}
                data-testid={`nav-${item.label.toLowerCase().replace(' ', '-')}`}
              >
                {isActive && (
                  <div className="absolute inset-0 bg-gradient-to-r from-white/10 to-transparent animate-pulse"></div>
                )}
                <div className={`relative p-2 rounded-lg mr-3 transition-all duration-200 ${
                  isActive 
                    ? 'bg-white/20 text-white' 
                    : 'bg-slate-800/50 group-hover:bg-slate-700/80'
                }`}>
                  <i className={`${item.icon} text-sm ${isActive ? 'animate-pulse' : 'group-hover:scale-110'} transition-transform duration-200`}></i>
                </div>
                <span className={`font-medium ${isActive ? 'text-white' : 'group-hover:text-slate-200'} transition-colors`}>
                  {item.label}
                </span>
                {isActive && (
                  <div className="absolute right-2 top-1/2 transform -translate-y-1/2 w-2 h-2 bg-white rounded-full animate-ping"></div>
                )}
              </div>
            </Link>
          );
        })}
      </nav>
      
      <div className="p-4 border-t border-slate-700/50">
        <div className="bg-slate-800/50 rounded-xl p-4 text-center backdrop-blur-sm">
          <div className="text-xs text-slate-400 leading-relaxed">
            <div className="flex items-center justify-center mb-2">
              <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse mr-2"></div>
              <span className="font-semibold text-slate-300">24/7 Hosting Active</span>
            </div>
            <div className="text-slate-500">
              Built with <i className="fas fa-heart text-red-400 animate-pulse"></i> using React & Express
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
}
