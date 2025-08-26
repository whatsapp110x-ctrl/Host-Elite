import { useState, useRef, useEffect } from 'react';
import { Editor } from '@monaco-editor/react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Save, FileText, Folder, ChevronRight, ChevronDown, X, RotateCcw } from 'lucide-react';
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

interface CodeEditorProps {
  botId: string;
  botName: string;
  isOpen: boolean;
  onClose: () => void;
}

export function CodeEditor({ botId, botName, isOpen, onClose }: CodeEditorProps) {
  const [selectedFile, setSelectedFile] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [isModified, setIsModified] = useState<boolean>(false);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [editorLanguage, setEditorLanguage] = useState<string>('plaintext');
  
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const editorRef = useRef<any>(null);

  // Fetch bot files
  const { data: files = [], isLoading: filesLoading } = useQuery<FileItem[]>({
    queryKey: ['/api/bots', botId, 'files'],
    enabled: isOpen && !!botId,
  });

  // Fetch file content
  const { data: fileContent, isLoading: contentLoading } = useQuery<FileContent>({
    queryKey: ['/api/bots', botId, 'files', selectedFile],
    enabled: !!selectedFile && !!botId,
  });

  // Handle file content changes
  useEffect(() => {
    if (fileContent) {
      setEditorContent(fileContent.content);
      setEditorLanguage(fileContent.language);
      setIsModified(false);
    }
  }, [fileContent]);

  // Save file mutation
  const saveFileMutation = useMutation({
    mutationFn: async () => {
      if (!selectedFile) throw new Error('No file selected');
      const response = await apiRequest('PUT', `/api/bots/${botId}/files/${encodeURIComponent(selectedFile)}`, {
        content: editorContent
      });
      return response.json();
    },
    onSuccess: () => {
      setIsModified(false);
      toast({
        title: 'File Saved',
        description: `${selectedFile} has been saved successfully`,
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
    if (value !== undefined) {
      setEditorContent(value);
      setIsModified(value !== (fileContent?.content || ''));
    }
  };

  const handleSave = () => {
    if (selectedFile && isModified) {
      saveFileMutation.mutate();
    }
  };

  const handleFileSelect = (filePath: string) => {
    if (isModified) {
      const confirmDiscard = confirm('You have unsaved changes. Discard them?');
      if (!confirmDiscard) return;
    }
    setSelectedFile(filePath);
  };

  const resetContent = () => {
    if (fileContent) {
      setEditorContent(fileContent.content);
      setIsModified(false);
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
        const isSelected = selectedFile === item.path;
        return (
          <div
            key={item.path}
            className={`flex items-center py-1 px-2 hover:bg-slate-700/50 cursor-pointer rounded transition-colors ${
              isSelected ? 'bg-purple-brand/20 border-l-2 border-purple-brand' : ''
            }`}
            style={{ paddingLeft: `${level * 20 + 24}px` }}
            onClick={() => handleFileSelect(item.path)}
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
              <button
                onClick={onClose}
                className="p-2 hover:bg-slate-700 rounded-lg transition-colors"
              >
                <X className="h-4 w-4 text-slate-400" />
              </button>
            </div>
            <p className="text-sm text-slate-400 mt-1">Bot Files & Source Code</p>
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
          {/* Editor Header */}
          <div className="bg-slate-800/90 border-b border-slate-700 p-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center">
                {selectedFile ? (
                  <>
                    <FileText className="h-5 w-5 text-green-400 mr-2" />
                    <span className="text-slate-100 font-medium">{selectedFile}</span>
                    {isModified && <div className="w-2 h-2 bg-orange-400 rounded-full ml-2"></div>}
                  </>
                ) : (
                  <span className="text-slate-400">Select a file to edit</span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {selectedFile && (
                  <>
                    <button
                      onClick={resetContent}
                      disabled={!isModified}
                      className="px-3 py-1 bg-slate-700 hover:bg-slate-600 disabled:opacity-50 disabled:cursor-not-allowed text-slate-300 rounded-lg text-sm flex items-center transition-colors"
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      Reset
                    </button>
                    <button
                      onClick={handleSave}
                      disabled={!isModified || saveFileMutation.isPending}
                      className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg font-medium flex items-center transition-colors"
                    >
                      <Save className="h-4 w-4 mr-2" />
                      {saveFileMutation.isPending ? 'Saving...' : 'Save'}
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Editor */}
          <div className="flex-1 bg-slate-900">
            {selectedFile ? (
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
                  language={editorLanguage}
                  value={editorContent}
                  onChange={handleEditorChange}
                  onMount={(editor) => {
                    editorRef.current = editor;
                  }}
                  theme="vs-dark"
                  options={{
                    fontSize: 14,
                    lineNumbers: 'on',
                    wordWrap: 'on',
                    minimap: { enabled: false },
                    scrollBeyondLastLine: false,
                    automaticLayout: true,
                    tabSize: 2,
                    insertSpaces: true,
                    detectIndentation: true,
                    renderWhitespace: 'selection',
                    folding: true,
                    lineHeight: 20,
                  }}
                />
              )
            ) : (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <FileText className="h-16 w-16 text-slate-600 mx-auto mb-4" />
                  <h3 className="text-xl font-semibold text-slate-300 mb-2">Code Editor</h3>
                  <p className="text-slate-400">Select a file from the sidebar to start editing</p>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}