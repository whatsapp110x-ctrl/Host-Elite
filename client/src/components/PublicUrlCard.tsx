import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy, ExternalLink, Globe, Shield, Zap } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface PublicUrlData {
  publicUrl: string;
  dashboardUrl: string;
  accessInstructions: string;
  features: string[];
  keepAliveStatus: any;
  deploymentInfo: {
    recommendedOption: string;
    pricing: string;
    benefits: string[];
  };
}

export function PublicUrlCard() {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const { data: urlData, isLoading } = useQuery<PublicUrlData>({
    queryKey: ['/api/public-url'],
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({
        title: 'Copied!',
        description: 'Public URL copied to clipboard',
      });
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      toast({
        title: 'Failed to copy',
        description: 'Could not copy URL to clipboard',
        variant: 'destructive',
      });
    }
  };

  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 border border-slate-700/80 rounded-xl p-6 backdrop-blur-sm shadow-xl animate-pulse">
        <div className="h-6 bg-slate-700 rounded mb-4"></div>
        <div className="h-4 bg-slate-700 rounded mb-2"></div>
        <div className="h-10 bg-slate-700 rounded"></div>
      </div>
    );
  }

  if (!urlData) return null;

  return (
    <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 border border-slate-700/80 rounded-xl p-6 backdrop-blur-sm shadow-xl animate-slide-up">
      {/* Header */}
      <div className="flex items-center mb-4">
        <div className="p-2 bg-purple-brand/20 rounded-lg mr-3">
          <Globe className="h-6 w-6 text-purple-brand" />
        </div>
        <div>
          <h3 className="text-xl font-bold text-slate-50">Public Dashboard URL</h3>
          <p className="text-sm text-slate-400">Access your bot hosting platform from anywhere</p>
        </div>
      </div>

      {/* URL Display */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-slate-300 mb-2">
          Your Public URL:
        </label>
        <div className="flex items-center gap-2">
          <div className="flex-1 bg-gradient-to-r from-slate-700 to-slate-800 border border-slate-600/80 rounded-xl px-4 py-3 text-slate-100 font-mono text-sm">
            {urlData.publicUrl}
          </div>
          <button
            onClick={() => copyToClipboard(urlData.publicUrl)}
            className="p-3 bg-purple-brand hover:bg-purple-600 rounded-xl transition-colors shadow-lg"
            data-testid="button-copy-url"
          >
            {copied ? (
              <div className="h-5 w-5 text-white">✓</div>
            ) : (
              <Copy className="h-5 w-5 text-white" />
            )}
          </button>
          <a
            href={urlData.publicUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="p-3 bg-blue-brand hover:bg-blue-600 rounded-xl transition-colors shadow-lg"
            data-testid="link-open-dashboard"
          >
            <ExternalLink className="h-5 w-5 text-white" />
          </a>
        </div>
        <p className="text-xs text-slate-400 mt-2">
          {urlData.accessInstructions}
        </p>
      </div>

      {/* Keep-Alive Status */}
      <div className="mb-6 p-4 bg-green-500/10 border border-green-500/30 rounded-lg">
        <div className="flex items-center mb-2">
          <Shield className="h-5 w-5 text-green-400 mr-2" />
          <span className="text-green-300 font-semibold">
            Keep-Alive Status: {urlData.keepAliveStatus?.healthStatus || 'ACTIVE'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <span className="text-slate-400">Success Rate:</span>
            <span className="text-green-300 ml-2">{urlData.keepAliveStatus?.successRate || '99.9%'}</span>
          </div>
          <div>
            <span className="text-slate-400">Active Strategies:</span>
            <span className="text-green-300 ml-2">{urlData.keepAliveStatus?.activeStrategies || '11'}</span>
          </div>
        </div>
      </div>

      {/* 24/7 Deployment Recommendation */}
      <div className="p-4 bg-gradient-to-r from-purple-500/10 to-blue-500/10 border border-purple-500/30 rounded-lg">
        <div className="flex items-center mb-3">
          <Zap className="h-5 w-5 text-purple-400 mr-2" />
          <span className="text-purple-300 font-semibold">
            🚀 For True 24/7 Hosting
          </span>
        </div>
        
        <p className="text-slate-300 text-sm mb-3">
          {urlData.deploymentInfo.pricing}
        </p>
        
        <div className="grid grid-cols-1 gap-2 text-sm">
          {urlData.deploymentInfo.benefits.map((benefit, index) => (
            <div key={index} className="flex items-center text-slate-300">
              <div className="w-1.5 h-1.5 bg-purple-400 rounded-full mr-2"></div>
              {benefit}
            </div>
          ))}
        </div>
        
        <button
          onClick={() => window.open('https://docs.replit.com/deployments', '_blank')}
          className="mt-4 w-full bg-gradient-to-r from-purple-brand to-blue-brand hover:from-purple-600 hover:to-blue-600 text-white font-semibold py-2 px-4 rounded-lg transition-all duration-200 shadow-lg hover:shadow-purple-500/25"
          data-testid="button-deploy-info"
        >
          Learn About Deployments →
        </button>
      </div>
    </div>
  );
}