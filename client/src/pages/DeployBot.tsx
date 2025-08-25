import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { insertBotSchema, type InsertBot } from '@shared/schema';
import { apiRequest } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

export default function DeployBot() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [selectedEnvFile, setSelectedEnvFile] = useState<File | null>(null);
  const [deploymentMethod, setDeploymentMethod] = useState<'zip' | 'github' | 'docker'>('zip');
  const [deploymentSuccess, setDeploymentSuccess] = useState<any>(null);

  const form = useForm<InsertBot & { zipFile?: File; envFile?: File }>({
    resolver: zodResolver(insertBotSchema),
    defaultValues: {
      name: '',
      language: 'python' as const,
      buildCommand: '',
      runCommand: '',
      userId: 'web_user',
      autoRestart: true,
      deploymentSource: 'zip' as const,
      githubRepoUrl: '',
    },
  });

  const deployMutation = useMutation({
    mutationFn: async (data: InsertBot & { zipFile?: File; envFile?: File }) => {
      const formData = new FormData();
      Object.entries(data).forEach(([key, value]) => {
        if (key === 'zipFile' && value instanceof File) {
          formData.append('zipFile', value);
        } else if (key === 'envFile' && value instanceof File) {
          formData.append('envFile', value);
        } else if (typeof value === 'boolean') {
          formData.append(key, value.toString());
        } else if (value !== null && value !== undefined) {
          formData.append(key, value.toString());
        }
      });

      const response = await apiRequest('POST', '/api/bots', formData);
      return response.json();
    },
    onSuccess: (data) => {
      toast({
        title: 'Success',
        description: `Bot ${data.name} deployed successfully! Deployment URL generated.`,
      });
      queryClient.invalidateQueries({ queryKey: ['/api/bots'] });
      queryClient.invalidateQueries({ queryKey: ['/api/stats'] });
      
      // Show deployment URL in a separate success state
      setDeploymentSuccess(data);
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const onSubmit = (data: InsertBot & { zipFile?: File; envFile?: File }) => {
    if (data.deploymentSource === 'zip' && !selectedFile) {
      toast({
        title: 'Error',
        description: 'Please select a ZIP file',
        variant: 'destructive',
      });
      return;
    }
    
    if (data.deploymentSource === 'github' && !data.githubRepoUrl) {
      toast({
        title: 'Error',
        description: 'Please enter a GitHub repository URL',
        variant: 'destructive',
      });
      return;
    }
    
    deployMutation.mutate({ 
      ...data, 
      zipFile: data.deploymentSource === 'zip' ? (selectedFile || undefined) : undefined,
      envFile: selectedEnvFile || undefined
    });
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (file.type !== 'application/zip' && !file.name.endsWith('.zip')) {
        toast({
          title: 'Error',
          description: 'Please select a valid ZIP file',
          variant: 'destructive',
        });
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        toast({
          title: 'Error',
          description: 'File size must be less than 50MB',
          variant: 'destructive',
        });
        return;
      }
      setSelectedFile(file);
    }
  };

  const handleEnvFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      if (!file.name.endsWith('.env') && !file.name.endsWith('config.env')) {
        toast({
          title: 'Error',
          description: 'Please select a valid .env or config.env file',
          variant: 'destructive',
        });
        return;
      }
      if (file.size > 1024 * 1024) { // 1MB limit for .env files
        toast({
          title: 'Error',
          description: 'Environment file size must be less than 1MB',
          variant: 'destructive',
        });
        return;
      }
      setSelectedEnvFile(file);
    }
  };

  const getPlaceholders = (language: string) => {
    if (language === 'python') {
      return {
        build: 'pip install -r requirements.txt',
        run: 'python bot.py',
      };
    } else {
      return {
        build: 'npm install',
        run: 'node index.js',
      };
    }
  };

  const currentLanguage = form.watch('language');
  const placeholders = getPlaceholders(currentLanguage);

  // Show deployment success page with URL
  if (deploymentSuccess) {
    return (
      <div className="p-6">
        <div className="max-w-4xl mx-auto">
          {/* Success Header */}
          <div className="mb-8 text-center animate-fade-in">
            <div className="relative inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-green-500 via-emerald-500 to-blue-500 rounded-2xl mb-6 shadow-lg animate-glow">
              <i className="fas fa-check text-white text-3xl animate-float"></i>
              <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full flex items-center justify-center">
                <i className="fas fa-link text-white text-xs"></i>
              </div>
            </div>
            <h1 className="text-4xl font-bold text-slate-50 mb-3">Bot Deployed Successfully!</h1>
            <p className="text-slate-300 text-lg max-w-2xl mx-auto">
              Your bot <span className="text-green-400 font-semibold">{deploymentSuccess.name}</span> is now live and accessible via a unique URL.
            </p>
          </div>

          <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 border border-slate-700/80 rounded-xl p-8 backdrop-blur-sm shadow-xl animate-slide-up">
            {/* Deployment URL Section */}
            <div className="mb-8">
              <h2 className="text-2xl font-bold mb-4 flex items-center">
                <i className="fas fa-link text-green-400 mr-3"></i>
                Your Bot's Access URL
              </h2>
              
              <div className="bg-gradient-to-r from-green-900/30 to-emerald-900/30 border border-green-500/50 rounded-lg p-6">
                <div className="flex items-center justify-between">
                  <div className="flex-1">
                    <p className="text-sm text-green-300 mb-2">
                      <i className="fas fa-globe mr-1"></i>
                      Public Access URL
                    </p>
                    <div className="bg-slate-800/50 border border-slate-600 rounded-lg px-4 py-3 font-mono text-green-400 break-all">
                      {deploymentSuccess.deploymentUrl}
                    </div>
                  </div>
                  <button
                    onClick={() => navigator.clipboard.writeText(deploymentSuccess.deploymentUrl)}
                    className="ml-4 bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-lg transition-colors"
                    data-testid="button-copy-url"
                  >
                    <i className="fas fa-copy mr-2"></i>
                    Copy
                  </button>
                </div>
                
                <div className="mt-4 flex flex-wrap gap-2">
                  <span className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-sm">
                    <i className="fas fa-shield-alt mr-1"></i>
                    24/7 Hosting
                  </span>
                  <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-sm">
                    <i className="fas fa-sync-alt mr-1"></i>
                    Auto-Restart
                  </span>
                  <span className="bg-purple-500/20 text-purple-300 px-3 py-1 rounded-full text-sm">
                    <i className="fas fa-chart-line mr-1"></i>
                    Live Monitoring
                  </span>
                </div>
              </div>
            </div>

            {/* Bot Information */}
            <div className="grid md:grid-cols-2 gap-6 mb-8">
              <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3 text-slate-200">Bot Details</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-slate-400">Name:</span>
                    <span className="text-slate-200">{deploymentSuccess.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Language:</span>
                    <span className="text-slate-200 capitalize">{deploymentSuccess.language}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Source:</span>
                    <span className="text-slate-200 capitalize">{deploymentSuccess.deploymentSource}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-400">Status:</span>
                    <span className="text-green-400">Deploying</span>
                  </div>
                </div>
              </div>

              <div className="bg-slate-800/50 border border-slate-600 rounded-lg p-4">
                <h3 className="text-lg font-semibold mb-3 text-slate-200">Next Steps</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex items-start">
                    <i className="fas fa-clock text-yellow-400 mr-2 mt-0.5"></i>
                    <span className="text-slate-300">Your bot is starting up (may take 1-2 minutes)</span>
                  </div>
                  <div className="flex items-start">
                    <i className="fas fa-share-alt text-blue-400 mr-2 mt-0.5"></i>
                    <span className="text-slate-300">Share the URL to give others access</span>
                  </div>
                  <div className="flex items-start">
                    <i className="fas fa-tachometer-alt text-green-400 mr-2 mt-0.5"></i>
                    <span className="text-slate-300">Monitor your bot from the dashboard</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4 justify-center">
              <button
                onClick={() => setLocation('/')}
                className="bg-gradient-to-r from-purple-brand to-blue-brand hover:from-purple-600 hover:to-blue-600 text-white px-6 py-3 rounded-xl transition-all duration-200 flex items-center"
                data-testid="button-dashboard"
              >
                <i className="fas fa-tachometer-alt mr-2"></i>
                Go to Dashboard
              </button>
              
              <a
                href={deploymentSuccess.deploymentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="bg-gradient-to-r from-green-500 to-emerald-500 hover:from-green-600 hover:to-emerald-600 text-white px-6 py-3 rounded-xl transition-all duration-200 flex items-center"
                data-testid="link-visit-bot"
              >
                <i className="fas fa-external-link-alt mr-2"></i>
                Visit Bot URL
              </a>
              
              <button
                onClick={() => setDeploymentSuccess(null)}
                className="bg-slate-600 hover:bg-slate-700 text-white px-6 py-3 rounded-xl transition-all duration-200 flex items-center"
                data-testid="button-deploy-another"
              >
                <i className="fas fa-plus mr-2"></i>
                Deploy Another Bot
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8 text-center animate-fade-in">
          <div className="relative inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-purple-brand via-purple-500 to-blue-brand rounded-2xl mb-6 shadow-lg animate-glow">
            <i className="fas fa-upload text-white text-3xl animate-float"></i>
            <div className="absolute -top-2 -right-2 w-6 h-6 bg-gradient-to-r from-green-400 to-emerald-400 rounded-full flex items-center justify-center">
              <i className="fas fa-plus text-white text-xs"></i>
            </div>
          </div>
          <h1 className="text-4xl font-bold text-slate-50 mb-3">Deploy Your Bot</h1>
          <p className="text-slate-300 text-lg max-w-2xl mx-auto">
            Upload your bot files and deploy to our secure 24/7 hosting platform. 
            <span className="text-purple-brand font-semibold"> Supports Python & Node.js</span>
          </p>
          <div className="flex justify-center gap-4 mt-4">
            <span className="bg-blue-500/20 text-blue-300 px-3 py-1 rounded-full text-sm font-medium">
              <i className="fab fa-python mr-1"></i>
              Python Ready
            </span>
            <span className="bg-green-500/20 text-green-300 px-3 py-1 rounded-full text-sm font-medium">
              <i className="fab fa-node-js mr-1"></i>
              Node.js Ready
            </span>
          </div>
        </div>

        <div className="bg-gradient-to-br from-slate-800/90 to-slate-900/90 border border-slate-700/80 rounded-xl p-8 backdrop-blur-sm shadow-xl animate-slide-up">
          <div className="flex items-center mb-6">
            <div className="p-2 bg-purple-brand/20 rounded-lg mr-3">
              <i className="fas fa-upload text-purple-brand text-xl"></i>
            </div>
            <h2 className="text-2xl font-bold">Deploy New Bot</h2>
          </div>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
            {/* Bot Information Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2">
                <i className="fas fa-info-circle mr-2 text-blue-brand"></i>
                Bot Information
              </h3>
              
              <div className="grid md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Bot Name *</label>
                  <input
                    {...form.register('name')}
                    type="text"
                    placeholder="my-awesome-bot"
                    className="w-full bg-gradient-to-r from-slate-700 to-slate-800 border border-slate-600/80 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-brand focus:border-purple-brand/50 transition-all duration-200 shadow-lg hover:shadow-purple-500/10 backdrop-blur-sm"
                    data-testid="input-bot-name"
                  />
                  {form.formState.errors.name && (
                    <p className="text-red-400 text-sm mt-1">{form.formState.errors.name.message}</p>
                  )}
                  <p className="text-xs text-slate-400 mt-1">Only letters, numbers, underscores, and hyphens allowed</p>
                </div>
                
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Language *</label>
                  <select
                    {...form.register('language')}
                    className="w-full bg-gradient-to-r from-slate-700 to-slate-800 border border-slate-600/80 rounded-xl px-4 py-3 text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-brand focus:border-purple-brand/50 transition-all duration-200 shadow-lg hover:shadow-purple-500/10 backdrop-blur-sm"
                    data-testid="select-language"
                  >
                    <option value="python">Python</option>
                    <option value="nodejs">Node.js</option>
                  </select>
                  {form.formState.errors.language && (
                    <p className="text-red-400 text-sm mt-1">{form.formState.errors.language.message}</p>
                  )}
                </div>
              </div>
            </div>

            {/* Deployment Method Selection */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2">
                <i className="fas fa-rocket mr-2 text-orange-400"></i>
                Deployment Method
              </h3>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div 
                  className={`p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                    deploymentMethod === 'zip' 
                      ? 'bg-purple-brand/20 border-purple-brand shadow-lg shadow-purple-500/25' 
                      : 'bg-slate-800/50 border-slate-600 hover:bg-slate-700/50'
                  }`}
                  onClick={() => {
                    setDeploymentMethod('zip');
                    form.setValue('deploymentSource', 'zip');
                  }}
                  data-testid="deployment-method-zip"
                >
                  <div className="flex items-center">
                    <i className={`fas fa-file-archive mr-3 ${
                      deploymentMethod === 'zip' ? 'text-purple-brand' : 'text-slate-400'
                    }`}></i>
                    <span className={`font-medium ${
                      deploymentMethod === 'zip' ? 'text-purple-brand' : 'text-slate-300'
                    }`}>Upload ZIP File</span>
                  </div>
                  <p className="text-slate-400 text-sm mt-1">Upload your bot files as a ZIP archive</p>
                </div>
                
                <div 
                  className={`p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                    deploymentMethod === 'github' 
                      ? 'bg-blue-500/20 border-blue-500 shadow-lg shadow-blue-500/25' 
                      : 'bg-slate-800/50 border-slate-600 hover:bg-slate-700/50'
                  }`}
                  onClick={() => {
                    setDeploymentMethod('github');
                    form.setValue('deploymentSource', 'github');
                  }}
                  data-testid="deployment-method-github"
                >
                  <div className="flex items-center">
                    <i className={`fab fa-github mr-3 ${
                      deploymentMethod === 'github' ? 'text-blue-400' : 'text-slate-400'
                    }`}></i>
                    <span className={`font-medium ${
                      deploymentMethod === 'github' ? 'text-blue-400' : 'text-slate-300'
                    }`}>GitHub Repository</span>
                  </div>
                  <p className="text-slate-400 text-sm mt-1">Deploy directly from a GitHub repository</p>
                </div>

                <div 
                  className={`p-4 border rounded-lg cursor-pointer transition-all duration-200 ${
                    deploymentMethod === 'docker' 
                      ? 'bg-cyan-500/20 border-cyan-500 shadow-lg shadow-cyan-500/25' 
                      : 'bg-slate-800/50 border-slate-600 hover:bg-slate-700/50'
                  }`}
                  onClick={() => {
                    setDeploymentMethod('docker');
                    form.setValue('deploymentSource', 'docker');
                  }}
                  data-testid="deployment-method-docker"
                >
                  <div className="flex items-center">
                    <i className={`fab fa-docker mr-3 ${
                      deploymentMethod === 'docker' ? 'text-cyan-400' : 'text-slate-400'
                    }`}></i>
                    <span className={`font-medium ${
                      deploymentMethod === 'docker' ? 'text-cyan-400' : 'text-slate-300'
                    }`}>Docker Container</span>
                  </div>
                  <p className="text-slate-400 text-sm mt-1">Deploy using Dockerfile from repository</p>
                </div>
              </div>
            </div>

            {/* Bot Files/Repository Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2">
                <i className={`mr-2 ${
                  deploymentMethod === 'github' ? 'fab fa-github text-blue-400' : 
                  deploymentMethod === 'docker' ? 'fab fa-docker text-cyan-400' : 
                  'fas fa-file-archive text-green-400'
                }`}></i>
                {deploymentMethod === 'github' ? 'GitHub Repository' : 
                 deploymentMethod === 'docker' ? 'Docker Repository' : 
                 'Bot Files'}
              </h3>
              
              {deploymentMethod === 'zip' ? (
                <div>
                  <label className="block text-slate-300 font-medium mb-2">ZIP File *</label>
                  <div className="border-2 border-dashed border-slate-600 rounded-lg p-8 text-center hover:border-purple-brand transition-colors">
                    <input
                      type="file"
                      accept=".zip"
                      onChange={handleFileChange}
                      className="hidden"
                      id="zip-upload"
                      data-testid="input-zip-file"
                    />
                    <label htmlFor="zip-upload" className="cursor-pointer">
                      {selectedFile ? (
                        <>
                          <i className="fas fa-file-archive text-4xl text-purple-brand mb-4"></i>
                          <p className="text-slate-300 font-medium mb-2">{selectedFile.name}</p>
                          <p className="text-slate-400 text-sm">File selected successfully</p>
                        </>
                      ) : (
                        <>
                          <i className="fas fa-cloud-upload-alt text-4xl text-slate-400 mb-4"></i>
                          <p className="text-slate-300 font-medium mb-2">Choose file or drag and drop</p>
                          <p className="text-slate-400 text-sm">Upload a ZIP file containing all your bot files. Maximum size: 50MB</p>
                          <div className="mt-4 p-3 bg-green-900/30 border border-green-700/50 rounded-lg">
                            <p className="text-sm text-green-300 mb-1">
                              <i className="fas fa-lightbulb mr-1"></i>
                              <strong>.env File Support:</strong>
                            </p>
                            <p className="text-xs text-slate-400">
                              Include a .env or config.env file in your ZIP to automatically set environment variables (API keys, tokens, etc.)
                            </p>
                          </div>
                        </>
                      )}
                    </label>
                  </div>
                </div>
              ) : deploymentMethod === 'github' ? (
                <div>
                  <label className="block text-slate-300 font-medium mb-2">GitHub Repository URL *</label>
                  <input
                    {...form.register('githubRepoUrl')}
                    type="url"
                    placeholder="https://github.com/username/repository"
                    className="w-full bg-gradient-to-r from-slate-700 to-slate-800 border border-slate-600/80 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500/50 transition-all duration-200 shadow-lg hover:shadow-blue-500/10 backdrop-blur-sm"
                    data-testid="input-github-repo-url"
                  />
                  {form.formState.errors.githubRepoUrl && (
                    <p className="text-red-400 text-sm mt-1">{form.formState.errors.githubRepoUrl.message}</p>
                  )}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-blue-900/30 border border-blue-700/50 rounded-lg">
                      <div className="flex items-center mb-2">
                        <i className="fas fa-check-circle text-green-400 mr-2"></i>
                        <span className="text-sm font-medium text-green-300">Supported Platforms</span>
                      </div>
                      <ul className="text-xs text-slate-400 space-y-1">
                        <li>• GitHub.com (public & private repos)</li>
                        <li>• GitLab.com</li>
                        <li>• Bitbucket.org</li>
                      </ul>
                    </div>
                    <div className="p-4 bg-amber-900/30 border border-amber-700/50 rounded-lg">
                      <div className="flex items-center mb-2">
                        <i className="fas fa-info-circle text-amber-400 mr-2"></i>
                        <span className="text-sm font-medium text-amber-300">Requirements</span>
                      </div>
                      <ul className="text-xs text-slate-400 space-y-1">
                        <li>• Repository must be public or accessible</li>
                        <li>• Include requirements.txt or package.json</li>
                        <li>• Main bot file in root directory</li>
                      </ul>
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <label className="block text-slate-300 font-medium mb-2">Docker Repository URL *</label>
                  <input
                    {...form.register('githubRepoUrl')}
                    type="url"
                    placeholder="https://github.com/username/dockerfile-bot"
                    className="w-full bg-gradient-to-r from-slate-700 to-slate-800 border border-slate-600/80 rounded-xl px-4 py-3 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500/50 transition-all duration-200 shadow-lg hover:shadow-cyan-500/10 backdrop-blur-sm"
                    data-testid="input-docker-repo-url"
                  />
                  {form.formState.errors.githubRepoUrl && (
                    <p className="text-red-400 text-sm mt-1">{form.formState.errors.githubRepoUrl.message}</p>
                  )}
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="p-4 bg-cyan-900/30 border border-cyan-700/50 rounded-lg">
                      <div className="flex items-center mb-2">
                        <i className="fab fa-docker text-cyan-400 mr-2"></i>
                        <span className="text-sm font-medium text-cyan-300">Auto-Detection</span>
                      </div>
                      <ul className="text-xs text-slate-400 space-y-1">
                        <li>• Automatically detects Dockerfile</li>
                        <li>• No build/run commands needed</li>
                        <li>• Handles environment variables</li>
                      </ul>
                    </div>
                    <div className="p-4 bg-green-900/30 border border-green-700/50 rounded-lg">
                      <div className="flex items-center mb-2">
                        <i className="fas fa-cogs text-green-400 mr-2"></i>
                        <span className="text-sm font-medium text-green-300">Container Benefits</span>
                      </div>
                      <ul className="text-xs text-slate-400 space-y-1">
                        <li>• Isolated environment</li>
                        <li>• Consistent deployment</li>
                        <li>• Easy scaling and management</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Additional Environment Variables Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2">
                <i className="fas fa-key mr-2 text-amber-400"></i>
                Additional Environment Variables (Optional)
              </h3>
              
              <div>
                <label className="block text-slate-300 font-medium mb-2">Upload Additional .env File</label>
                <div className="border-2 border-dashed border-slate-600 rounded-lg p-6 text-center hover:border-amber-400 transition-colors">
                  <input
                    type="file"
                    accept=".env,.config.env"
                    onChange={handleEnvFileChange}
                    className="hidden"
                    id="env-upload"
                    data-testid="input-env-file"
                  />
                  <label htmlFor="env-upload" className="cursor-pointer">
                    {selectedEnvFile ? (
                      <>
                        <i className="fas fa-file-code text-3xl text-amber-400 mb-3"></i>
                        <p className="text-slate-300 font-medium mb-1">{selectedEnvFile.name}</p>
                        <p className="text-slate-400 text-sm">Additional .env file selected</p>
                      </>
                    ) : (
                      <>
                        <i className="fas fa-plus-circle text-3xl text-slate-400 mb-3"></i>
                        <p className="text-slate-300 font-medium mb-1">Add Environment Variables</p>
                        <p className="text-slate-400 text-sm">Upload a .env or config.env file to override or add environment variables</p>
                      </>
                    )}
                  </label>
                </div>
                <div className="mt-3 p-3 bg-amber-900/30 border border-amber-700/50 rounded-lg">
                  <p className="text-sm text-amber-300 mb-2">
                    <i className="fas fa-info-circle mr-1"></i>
                    <strong>How it works:</strong>
                  </p>
                  <ul className="text-xs text-slate-400 space-y-1">
                    <li>• Variables from this file will override any from the ZIP's .env file</li>
                    <li>• Perfect for keeping sensitive keys separate from your code</li>
                    <li>• Supports both .env and config.env file formats</li>
                    <li>• Use standard format: KEY=value (one per line)</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Build Configuration Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2">
                <i className="fas fa-cog mr-2 text-yellow-400"></i>
                Build Configuration
              </h3>
              
              <div>
                <label className="block text-slate-300 font-medium mb-2">Build Command (Optional)</label>
                <input
                  {...form.register('buildCommand')}
                  type="text"
                  placeholder={placeholders.build}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-brand focus:border-transparent font-mono text-sm"
                  data-testid="input-build-command"
                />
                <p className="text-xs text-slate-400 mt-1">Command to install dependencies or build your bot. Leave empty if no dependencies needed.</p>
              </div>
              
              <div>
                <label className="block text-slate-300 font-medium mb-2">Run Command *</label>
                <input
                  {...form.register('runCommand')}
                  type="text"
                  placeholder={placeholders.run}
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-brand focus:border-transparent font-mono text-sm"
                  data-testid="input-run-command"
                />
                {form.formState.errors.runCommand && (
                  <p className="text-red-400 text-sm mt-1">{form.formState.errors.runCommand.message}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">Command to start your bot</p>
              </div>
            </div>

            {/* Deployment Settings Section */}
            <div className="space-y-4">
              <h3 className="text-lg font-semibold text-slate-200 border-b border-slate-700 pb-2">
                <i className="fas fa-sliders-h mr-2 text-blue-400"></i>
                Deployment Settings
              </h3>
              
              <div>
                <label className="block text-slate-300 font-medium mb-2">User ID</label>
                <input
                  {...form.register('userId')}
                  type="text"
                  className="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-brand focus:border-transparent"
                  data-testid="input-user-id"
                />
                <p className="text-xs text-slate-400 mt-1">This identifies who owns this bot</p>
              </div>

              <div className="flex items-center space-x-3">
                <input
                  {...form.register('autoRestart')}
                  type="checkbox"
                  id="auto-restart"
                  className="w-4 h-4 text-purple-brand bg-slate-700 border-slate-600 rounded focus:ring-purple-brand focus:ring-2"
                  data-testid="checkbox-auto-restart"
                />
                <label htmlFor="auto-restart" className="text-slate-300">Enable auto-restart on crash</label>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="flex flex-col sm:flex-row gap-4 pt-6 border-t border-slate-700">
              <button
                type="submit"
                disabled={deployMutation.isPending}
                className="flex-1 bg-gradient-to-r from-purple-brand to-purple-600 hover:from-purple-600 hover:to-purple-700 disabled:from-slate-600 disabled:to-slate-700 text-white px-6 py-3 rounded-lg font-medium transition-all duration-200 flex items-center justify-center"
                data-testid="button-deploy-bot"
              >
                {deployMutation.isPending ? (
                  <>
                    <i className="fas fa-spinner fa-spin mr-2"></i>
                    Deploying...
                  </>
                ) : (
                  <>
                    <i className="fas fa-rocket mr-2"></i>
                    Deploy Bot
                  </>
                )}
              </button>
              <Link href="/">
                <a className="flex-1 bg-slate-700 hover:bg-slate-600 text-slate-300 px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center">
                  <i className="fas fa-arrow-left mr-2"></i>
                  Back to Dashboard
                </a>
              </Link>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
