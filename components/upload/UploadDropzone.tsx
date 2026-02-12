"use client";

import { useCallback, useState } from "react";
import { useUpload, UploadItem } from "@/hooks/useUpload";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Upload, X, FileVideo, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export function UploadDropzone() {
  const { uploads, addUploads, removeUpload, cancelUpload, clearCompleted, isProcessing } = useUpload();
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files).filter((file) =>
      file.type.startsWith("video/")
    );

    if (files.length > 0) {
      addUploads(files);
    }
  }, [addUploads]);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(e.target.files || []).filter((file) =>
        file.type.startsWith("video/")
      );

      if (files.length > 0) {
        addUploads(files);
      }
    },
    [addUploads]
  );

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  };

  const getStatusIcon = (status: UploadItem["status"]) => {
    switch (status) {
      case "pending":
        return <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />;
      case "encrypting":
        return <Loader2 className="h-4 w-4 animate-spin text-blue-500" />;
      case "uploading":
        return <Loader2 className="h-4 w-4 animate-spin text-primary" />;
      case "completed":
        return <CheckCircle2 className="h-4 w-4 text-green-500" />;
      case "error":
        return <AlertCircle className="h-4 w-4 text-red-500" />;
    }
  };

  const getStatusText = (status: UploadItem["status"]) => {
    switch (status) {
      case "pending":
        return "Waiting...";
      case "encrypting":
        return "Encrypting...";
      case "uploading":
        return "Uploading...";
      case "completed":
        return "Completed";
      case "error":
        return "Failed";
    }
  };

  return (
    <div className="space-y-4">
      {/* Dropzone */}
      <label
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "flex flex-col items-center justify-center w-full h-48 rounded-xl border-2 border-dashed cursor-pointer transition-colors",
          isDragOver
            ? "border-primary bg-primary/5"
            : "border-muted-foreground/20 hover:border-muted-foreground/40 hover:bg-accent/50"
        )}
      >
        <div className="flex flex-col items-center justify-center pt-5 pb-6">
          <div className={cn(
            "p-4 rounded-full mb-3 transition-colors",
            isDragOver ? "bg-primary/10" : "bg-muted"
          )}>
            <Upload className={cn(
              "h-8 w-8",
              isDragOver ? "text-primary" : "text-muted-foreground"
            )} />
          </div>
          <p className="mb-2 text-sm text-foreground">
            <span className="font-semibold">Click to upload</span> or drag and drop
          </p>
          <p className="text-xs text-muted-foreground">
            Videos are encrypted before upload (MP4, MOV, WebM, etc.)
          </p>
        </div>
        <input
          type="file"
          className="hidden"
          accept="video/*"
          multiple
          onChange={handleFileSelect}
        />
      </label>

      {/* Upload list */}
      {uploads.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-medium">Uploads</h4>
            {uploads.some((u) => u.status === "completed" || u.status === "error") && (
              <Button variant="ghost" size="sm" onClick={clearCompleted}>
                Clear completed
              </Button>
            )}
          </div>

          <div className="space-y-2 max-h-64 overflow-y-auto">
            {uploads.map((upload) => (
              <div
                key={upload.id}
                className="rounded-lg border bg-card p-3 space-y-2"
              >
                <div className="flex items-center gap-3">
                  <FileVideo className="h-5 w-5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate">{upload.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatFileSize(upload.size)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground flex items-center gap-1">
                      {getStatusIcon(upload.status)}
                      {getStatusText(upload.status)}
                    </span>
                    {upload.status !== "completed" && upload.status !== "error" && (
                      <button
                        onClick={() => cancelUpload(upload.id)}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                    {(upload.status === "completed" || upload.status === "error") && (
                      <button
                        onClick={() => removeUpload(upload.id)}
                        className="p-1 hover:bg-muted rounded"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="space-y-1">
                  <Progress value={upload.progress} />
                  <div className="flex justify-between text-xs text-muted-foreground">
                    <span>{upload.progress}%</span>
                    {upload.uploadSpeed && upload.uploadSpeed > 0 && (
                      <span>{upload.uploadSpeed.toFixed(2)} MB/s</span>
                    )}
                  </div>
                </div>

                {upload.error && (
                  <p className="text-xs text-red-500">{upload.error}</p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
