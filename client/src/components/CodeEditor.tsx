import { useState, useRef, useEffect, useCallback } from 'react';
import { Editor } from '@monaco-editor/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, FileText, Folder, ChevronRight, ChevronDown, X, RotateCcw, Plus, Trash2, Edit3, Search, Upload, Download, Copy, FolderPlus, MoreHorizontal } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiRequest } from '@/lib/queryClient';

interface FileItem {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
}

interface FileContent {
  content: string;
  isText: boolean;
  language: string;
}

interface Tab {
  id: string;
  name: string;
  path: string;
  content: string;
  isModified: boolean;
  language: string;
}

interface CodeEditorProps {
  botId: string;
  botName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CodeEditor({ botId, botName, isOpen, onClose }: CodeEditorProps) {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string>('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [showSearch, setShowSearch] = useState<boolean>(false);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [contextMenuFile, setContextMenuFile] = useState<string | null>(null);
  const [showNewFileDialog, setShowNewFileDialog] = useState<boolean>(false);
  const [newFileName, setNewFileName] = useState<string>('');
  const [autoSaveEnabled, setAutoSaveEnabled] = useState<boolean>(true);
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editorRef = useRef<any>(null);

  // Get active tab
  const activeTab = tabs.find(tab => tab.id === activeTabId);

  // Fetch bot files
  const { data: files = [], isLoading: filesLoading } = useQuery<FileItem[]>({
    queryKey: ['/api/bots', botId, 'files'],
    enabled: isOpen && !!botId,
  });

  // Fetch file content for active tab
  const { data: fileContent, isLoading: contentLoading } = useQuery<FileContent>({
    queryKey: ['/api/bots', botId, 'files', activeTab?.path],
    enabled: !!activeTab?.path && !!botId,
  });
  
  // Handle file content changes
  useEffect(() => {
    if (fileContent && activeTab) {
      setTabs(prevTabs => 
        prevTabs.map(tab => 
          tab.id === activeTabId 
            ? { ...tab, content: fileContent.content, language: fileContent.language, isModified: false }
            : tab
        )
      );
    }
  }, [fileContent, activeTabId, activeTab]);

  // Save file mutation
  const saveFileMutation = useMutation({
    mutationFn: async ({ tabId, path, content }: { tabId: string; path: string; content: string }) => {
      const response = await apiRequest('PUT', `/api/bots/${botId}/files/${encodeURIComponent(path)}`, {
        content
      });
      return { tabId, response: await response.json() };
    },
    onSuccess: ({ tabId }) => {
      setTabs(prevTabs => 
        prevTabs.map(tab => 
          tab.id === tabId 
            ? { ...tab, isModified: false }
            : tab
        )
      );
      const tab = tabs.find(t => t.id === tabId);
      toast({
        title: 'File Saved',
        description: `${tab?.name} has been saved successfully`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Save Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const toggleDirectory = (dirPath: string) => {
    const newExpanded = new Set(expandedDirs);
    if (newExpanded.has(dirPath)) {
      newExpanded.delete(dirPath);
    } else {
      newExpanded.add(dirPath);
    }
    setExpandedDirs(newExpanded);
  };

  const handleEditorChange = (value: string | undefined) => {
    if (value !== undefined && activeTab) {
      setTabs(prevTabs => 
        prevTabs.map(tab => 
          tab.id === activeTabId 
            ? { ...tab, content: value, isModified: value !== (fileContent?.content || '') }
            : tab
        )
      );
    }
  };

  const handleSave = (tabId?: string) => {
    const tab = tabId ? tabs.find(t => t.id === tabId) : activeTab;
    if (tab && tab.isModified) {
      saveFileMutation.mutate({
        tabId: tab.id,
        path: tab.path,
        content: tab.content
      });
    }
  };

  const handleFileSelect = (filePath: string) => {
    // Check if file is already open in a tab
    const existingTab = tabs.find(tab => tab.path === filePath);
    if (existingTab) {
      setActiveTabId(existingTab.id);
      return;
    }

    // Create new tab
    const newTab: Tab = {
      id: `tab_${Date.now()}_${Math.random()}`,
      name: filePath.split('/').pop() || filePath,
      path: filePath,
      content: '',
      isModified: false,
      language: 'plaintext'
    };

    setTabs(prevTabs => [...prevTabs, newTab]);
    setActiveTabId(newTab.id);
  };

  const resetContent = () => {
    if (fileContent && activeTab) {
      setTabs(prevTabs => 
        prevTabs.map(tab => 
          tab.id === activeTabId 
            ? { ...tab, content: fileContent.content, isModified: false }
            : tab
        )
      );
    }
  };

  const closeTab = (tabId: string) => {
    const tab = tabs.find(t => t.id === tabId);
    if (tab?.isModified) {
      const confirmClose = confirm('You have unsaved changes. Close anyway?');
      if (!confirmClose) return;
    }

    setTabs(prevTabs => prevTabs.filter(t => t.id !== tabId));
    
    if (activeTabId === tabId) {
      const remainingTabs = tabs.filter(t => t.id !== tabId);
      setActiveTabId(remainingTabs.length > 0 ? remainingTabs[0].id : '');
    }
  };

  const saveAllTabs = () => {
    tabs.filter(tab => tab.isModified).forEach(tab => {
      handleSave(tab.id);
    });
  };

  // Auto-save functionality
  useEffect(() => {
    if (!autoSaveEnabled || !activeTab?.isModified) return;

    const autoSaveTimer = setTimeout(() => {
      if (activeTab.isModified) {
        handleSave(activeTab.id);
        toast({
          title: 'Auto-saved',
          description: `${activeTab.name} has been auto-saved`,
          duration: 2000,
        });
      }
    }, 2000); // Auto-save after 2 seconds of inactivity

    return () => clearTimeout(autoSaveTimer);
  }, [activeTab?.content, activeTab?.isModified, autoSaveEnabled]);

  // Create file mutations
  const createFileMutation = useMutation({
    mutationFn: async ({ filePath, content = '', type = 'file' }: { filePath: string; content?: string; type?: 'file' | 'directory' }) => {
      const response = await apiRequest('POST', `/api/bots/${botId}/files`, {
        filePath,
        content,
        type
      });
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bots', botId, 'files'] });
      setShowNewFileDialog(false);
      setNewFileName('');
      toast({
        title: 'File Created',
        description: 'New file created successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Creation Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Delete file mutation
  const deleteFileMutation = useMutation({
    mutationFn: async (filePath: string) => {
      const response = await apiRequest('DELETE', `/api/bots/${botId}/files/${encodeURIComponent(filePath)}`);
      return response.json();
    },
    onSuccess: (_, filePath) => {
      queryClient.invalidateQueries({ queryKey: ['/api/bots', botId, 'files'] });
      // Close tab if file was open
      const openTab = tabs.find(tab => tab.path === filePath);
      if (openTab) {
        closeTab(openTab.id);
      }
      toast({
        title: 'File Deleted',
        description: 'File deleted successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Delete Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  // Rename file mutation
  const renameFileMutation = useMutation({
    mutationFn: async ({ oldPath, newPath }: { oldPath: string; newPath: string }) => {
      const response = await apiRequest('PATCH', `/api/bots/${botId}/files/${encodeURIComponent(oldPath)}`, {
        newPath
      });
      return response.json();
    },
    onSuccess: ({ oldPath, newPath }) => {
      queryClient.invalidateQueries({ queryKey: ['/api/bots', botId, 'files'] });
      // Update tab if file was open
      const openTab = tabs.find(tab => tab.path === oldPath);
      if (openTab) {
        setTabs(prevTabs => 
          prevTabs.map(tab => 
            tab.id === openTab.id 
              ? { ...tab, path: newPath, name: newPath.split('/').pop() || newPath }
              : tab
          )
        );
      }
      toast({
        title: 'File Renamed',
        description: 'File renamed successfully',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Rename Failed',
        description: error.message,
        variant: 'destructive',
      });
    },
  });

  const handleCreateFile = () => {
    if (!newFileName.trim()) return;
    createFileMutation.mutate({ filePath: newFileName.trim() });
  };

  const handleCreateFolder = () => {
    if (!newFileName.trim()) return;
    createFileMutation.mutate({ filePath: newFileName.trim(), type: 'directory' });
  };

  const handleDeleteFile = (filePath: string) => {
    if (confirm(`Are you sure you want to delete ${filePath}?`)) {
      deleteFileMutation.mutate(filePath);
    }
  };

  const handleRenameFile = (oldPath: string) => {
    const newPath = prompt('Enter new name:', oldPath);
    if (newPath && newPath !== oldPath) {
      renameFileMutation.mutate({ oldPath, newPath });
    }
  };

  // Build file tree
  const buildFileTree = (files: FileItem[]) => {
    const tree: { [key: string]: FileItem[] } = {};
    const rootFiles: FileItem[] = [];

    files.forEach(file => {
      const parts = file.path.split('/');
      if (parts.length === 1) {
        rootFiles.push(file);
      } else {
        const parentDir = parts.slice(0, -1).join('/');
        if (!tree[parentDir]) tree[parentDir] = [];
        tree[parentDir].push(file);
      }
    });

    return { tree, rootFiles };
  };

  const renderFileTree = (items: FileItem[], level = 0) => {
    return items.map((item) => {
      if (item.type === 'directory') {
        const isExpanded = expandedDirs.has(item.path);
        const { tree } = buildFileTree(files);
        const children = tree[item.path] || [];

        return (
          <div key={item.path}>
            <div
              className={`flex items-center py-1 px-2 hover:bg-slate-700/50 cursor-pointer rounded`}
              style={{ paddingLeft: `${level * 20 + 8}px` }}
              onClick={() => toggleDirectory(item.path)}
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4 text-slate-400 mr-1" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400 mr-1" />
              )}
              <Folder className="h-4 w-4 text-blue-400 mr-2" />
              <span className="text-slate-300 text-sm">{item.name}</span>
            </div>
            {isExpanded && children.length > 0 && (
              <div>{renderFileTree(children, level + 1)}</div>
            )}
          </div>
        );
      } else {
        const isSelected = tabs.some(tab => tab.path === item.path);
        return (
          <div
            key={item.path}
            className={`group flex items-center py-1 px-2 hover:bg-slate-700/50 cursor-pointer rounded transition-colors ${
              isSelected ? 'bg-purple-brand/20 border-l-2 border-purple-brand' : ''
            }`}
            style={{ paddingLeft: `${level * 20 + 24}px` }}
            onClick={() => handleFileSelect(item.path)}
            onContextMenu={(e) => {
              e.preventDefault();
              setContextMenuFile(item.path);
            }}
          >
            <FileText className="h-4 w-4 text-green-400 mr-2" />
            <div className="flex-1">
              <span className={`text-sm ${isSelected ? 'text-purple-100' : 'text-slate-300'}`}>
                {item.name}
              </span>
              {item.size && (
                <span className="text-xs text-slate-500 ml-2">
                  ({(item.size / 1024).toFixed(1)}KB)
                </span>
              )}
            </div>
            <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleRenameFile(item.path);
                }}
                className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-slate-200"
                title="Rename"
              >
                <Edit3 className="h-3 w-3" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteFile(item.path);
                }}
                className="p-1 hover:bg-slate-600 rounded text-slate-400 hover:text-red-400"
                title="Delete"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          </div>
        );
      }
    });
  };

  if (!isOpen) return null;

  const { rootFiles } = buildFileTree(files);

  return (
    <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex">
      <div className="w-full h-full bg-gradient-to-br from-slate-900 to-slate-800 flex">
        {/* Sidebar - File Explorer */}
        <div className="w-80 bg-slate-800/90 border-r border-slate-700 flex flex-col">
          <div className="p-4 border-b border-slate-700">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-100 flex items-center">
                <Folder className="h-5 w-5 text-blue-400 mr-2" />
                {botName}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowNewFileDialog(true)}
                  className="p-2 hover:bg-slate-700 rounded-lg transition-colors text-slate-400 hover:text-slate-200"
                  title="Create new file"
                >
                  <Plus className="h-4 w-4" />
                </button>
                <button
                  onClick={onClose}
                  className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
                >
                  <X className="h-4 w-4 text-slate-400" />
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between mt-1">
              <p className="text-sm text-slate-400">Bot Files & Source Code</p>
              <label className="flex items-center text-xs text-slate-400">
                <input
                  type="checkbox"
                  checked={autoSaveEnabled}
                  onChange={(e) => setAutoSaveEnabled(e.target.checked)}
                  className="mr-1 rounded"
                />
                Auto-save
              </label>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-2">
            {filesLoading ? (
              <div className="flex items-center justify-center py-8">
                <div className="w-6 h-6 bg-purple-brand rounded-full animate-spin"></div>
              </div>
            ) : files.length === 0 ? (
              <div className="text-center py-8 text-slate-400">
                <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>No files found</p>
              </div>
            ) : (
              renderFileTree(rootFiles)
            )}
          </div>
        </div>

        {/* Main Editor Area */}
        <div className="flex-1 flex flex-col">
          {/* Tabs Bar */}
          {tabs.length > 0 && (
            <div className="bg-slate-800/90 border-b border-slate-700 flex items-center overflow-x-auto">
              {tabs.map(tab => (
                <div
                  key={tab.id}
                  className={`flex items-center px-4 py-2 border-r border-slate-700 cursor-pointer min-w-0 max-w-48 ${
                    activeTabId === tab.id 
                      ? 'bg-purple-brand/20 text-purple-100' 
                      : 'text-slate-300 hover:bg-slate-700/50'
                  }`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  <FileText className="h-4 w-4 mr-2 flex-shrink-0" />
                  <span className="text-sm truncate" title={tab.path}>
                    {tab.name}
                  </span>
                  {tab.isModified && (
                    <div className="w-2 h-2 bg-orange-400 rounded-full ml-2 flex-shrink-0"></div>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      closeTab(tab.id);
                    }}
                    className="ml-2 p-1 hover:bg-slate-600 rounded flex-shrink-0"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Editor Header */}
          <div className="bg-slate-800/90 border-b border-slate-700 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {activeTab ? (
                  <>
                    <FileText className="h-5 w-5 text-green-400 mr-2" />
                    <span className="text-slate-100 font-medium">{activeTab.path}</span>
                    {activeTab.isModified && <div className="w-2 h-2 bg-orange-400 rounded-full ml-2"></div>}
                  </>
                ) : (
                  <span className="text-slate-400">Select a file to edit</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowSearch(!showSearch)}
                  className={`px-3 py-1 rounded-lg text-sm flex items-center transition-colors ${
                    showSearch 
                      ? 'bg-purple-brand text-white' 
                      : 'bg-slate-700 hover:bg-slate-600 text-slate-300'
                  }`}
                >
                  <Search className="h-4 w-4 mr-1" />
                  Search
                </button>
                
                {tabs.some(tab => tab.isModified) && (
                  <button
                    onClick={saveAllTabs}
                    className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm flex items-center transition-colors"
                  >
                    <Save className="h-4 w-4 mr-1" />
                    Save All
                  </button>
                )}
                
                {activeTab && (
                  <>
                    <button
                      onClick={resetContent}
                      disabled={!activeTab.isModified}
                      className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-lg text-sm flex items-center transition-colors"
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Reset
                    </button>
                    <button
                      onClick={() => handleSave()}
                      disabled={!activeTab.isModified || saveFileMutation.isPending}
                      className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center transition-colors"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {saveFileMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Search Bar */}
            {showSearch && (
              <div className="mt-3 p-3 bg-slate-700/50 rounded-lg">
                <div className="flex items-center gap-2">
                  <Search className="h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search in files..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    className="flex-1 bg-slate-600 text-slate-100 placeholder-slate-400 border border-slate-500 rounded px-3 py-1 text-sm focus:outline-none focus:border-purple-brand"
                  />
                  <button className="px-3 py-1 bg-purple-brand hover:bg-purple-700 text-white rounded text-sm">
                    Find
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Editor */}
          <div className="flex-1 bg-slate-900">
            {activeTab ? (
              contentLoading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <div className="w-8 h-8 bg-purple-brand rounded-full animate-spin mx-auto mb-4"></div>
                    <p className="text-slate-400">Loading file...</p>
                  </div>
                </div>
              ) : (
                <Editor
                  height="100%"
                  language={activeTab.language}
                  value={activeTab.content}
                  onChange={handleEditorChange}
                  onMount={(editor) => {
                    editorRef.current = editor;
                  }}
                  theme="vs-dark"
                  options={{
                    fontSize: 14,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    minimap: { enabled: true },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    insertSpaces: true,
                    detectIndentation: true,
                    renderWhitespace: 'selection',
                    folding: true,
                    lineHeight: 20,
                    bracketPairColorization: { enabled: true },
                    formatOnType: true,
                    formatOnPaste: true,
                    quickSuggestions: true,
                    suggestOnTriggerCharacters: true,
                    parameterHints: { enabled: true },
                    hover: { enabled: true },
                  }}
                />
              )
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <FileText className="h-16 w-16 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-slate-300 mb-2">Enhanced Code Editor</h3>
                  <p className="text-slate-400">Select a file from the sidebar to start editing</p>
                  <p className="text-slate-500 text-sm mt-2">Features: Multiple tabs, auto-save, search, syntax highlighting</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* New File Dialog */}
      {showNewFileDialog && (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-slate-800 rounded-lg p-6 w-96 border border-slate-700">
            <h3 className="text-lg font-semibold text-slate-100 mb-4">Create New File/Folder</h3>
            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-300 mb-2">
                Name
              </label>
              <input
                type="text"
                value={newFileName}
                onChange={(e) => setNewFileName(e.target.value)}
                placeholder="e.g., main.py or src/utils.js"
                className="w-full bg-slate-700 text-slate-100 placeholder-slate-400 border border-slate-600 rounded px-3 py-2 focus:outline-none focus:border-purple-brand"
                onKeyPress={(e) => {
                  if (e.key === 'Enter') {
                    handleCreateFile();
                  }
                }}
                autoFocus
              />
            </div>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowNewFileDialog(false);
                  setNewFileName('');
                }}
                className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateFolder}
                disabled={!newFileName.trim() || createFileMutation.isPending}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <FolderPlus className="h-4 w-4 mr-2 inline" />
                Folder
              </button>
              <button
                onClick={handleCreateFile}
                disabled={!newFileName.trim() || createFileMutation.isPending}
                className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors"
              >
                <Plus className="h-4 w-4 mr-2 inline" />
                File
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}