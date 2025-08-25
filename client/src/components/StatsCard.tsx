interface StatsCardProps {
  icon: string;
  iconColor: string;
  value: number;
  label: string;
  testId?: string;
}

export function StatsCard({ icon, iconColor, value, label, testId }: StatsCardProps) {
  const getGradientClass = (color: string) => {
    if (color.includes('green')) return 'from-green-500/10 to-emerald-500/10 border-green-500/30';
    if (color.includes('yellow')) return 'from-yellow-500/10 to-amber-500/10 border-yellow-500/30';
    if (color.includes('red')) return 'from-red-500/10 to-rose-500/10 border-red-500/30';
    return 'from-slate-700/50 to-slate-800/50 border-slate-600/50';
  };

  return (
    <div className={`bg-gradient-to-br ${getGradientClass(iconColor)} border backdrop-blur-sm rounded-xl p-6 hover:border-opacity-60 transition-all duration-300 hover:scale-105 hover:shadow-lg animate-fade-in group`}>
      <div className="flex items-center justify-between mb-3">
        <div className="p-2 rounded-lg bg-slate-800/50 group-hover:bg-slate-700/50 transition-colors">
          <i className={`${icon} ${iconColor} text-xl group-hover:scale-110 transition-transform duration-200`}></i>
        </div>
        <span 
          className={`text-3xl font-bold ${iconColor === 'text-slate-400' ? 'text-slate-50' : iconColor} group-hover:scale-105 transition-transform duration-200`}
          data-testid={testId}
        >
          {value}
        </span>
      </div>
      <p className="text-slate-300 font-medium group-hover:text-slate-200 transition-colors">{label}</p>
    </div>
  );
}
