# Overview

Host-Elite is a 24/7 bot hosting platform that enables users to deploy and manage Python and Node.js bots through a modern web interface. The platform provides real-time bot management, live log monitoring, and automated deployment capabilities with support for ZIP file uploads and WebSocket-based real-time updates.

# User Preferences

Preferred communication style: Simple, everyday language.

# System Architecture

## Frontend Architecture

The frontend is built using React with TypeScript and employs a modern component-based architecture:

- **Framework**: React 18 with TypeScript for type safety
- **Routing**: Wouter for lightweight client-side routing
- **State Management**: TanStack Query for server state management and caching
- **UI Components**: Radix UI primitives with shadcn/ui component library
- **Styling**: Tailwind CSS with custom design tokens and dark theme
- **Build Tool**: Vite for fast development and optimized production builds

The application follows a single-page application (SPA) pattern with the following key pages:
- Dashboard for bot overview and statistics
- Deploy Bot for uploading and configuring new bots
- Live Logs for real-time log monitoring
- Deployment Guide for user documentation

## Backend Architecture

The backend uses a Node.js/Express architecture with real-time capabilities:

- **Framework**: Express.js with TypeScript
- **WebSocket**: WebSocket server for real-time log streaming and status updates
- **File Upload**: Multer for handling ZIP file uploads with memory storage
- **Process Management**: Node.js child_process for spawning and managing bot processes
- **Storage**: In-memory storage with interface for future database integration

Key services include:
- BotManager for process lifecycle management
- FileManager for ZIP extraction and file system operations
- Storage interface with memory-based implementation

## Data Storage Solutions

The application currently uses an in-memory storage system with a well-defined interface:

- **Current Implementation**: MemStorage class for development and testing
- **Database Ready**: Drizzle ORM configured for PostgreSQL migration
- **Schema**: Defined database schemas for users and bots with proper relationships
- **Future Migration**: Interface-based design allows easy transition to PostgreSQL

The database schema includes:
- Users table for authentication
- Bots table with metadata, status, and deployment information
- Support for bot lifecycle states (stopped, running, error, deploying)

## Authentication and Authorization

Currently implements a simplified authentication system:
- Basic user schema with username/password
- Default "web_user" for bot ownership
- Prepared for future session-based or token-based authentication
- Password hashing and validation schemas defined

## External Dependencies

### Core Framework Dependencies
- **@neondatabase/serverless**: Neon PostgreSQL serverless driver for database connectivity
- **drizzle-orm**: Type-safe SQL query builder and ORM
- **drizzle-kit**: Database migration and schema management tools

### Frontend Dependencies
- **@tanstack/react-query**: Server state management and caching
- **@radix-ui/***: Comprehensive set of UI primitives for building accessible components
- **@hookform/resolvers**: Form validation with Zod schema integration
- **wouter**: Lightweight routing library for React
- **class-variance-authority**: Utility for creating variant-based component APIs

### Backend Dependencies
- **multer**: File upload middleware for handling ZIP files
- **adm-zip**: ZIP file extraction and manipulation
- **ws**: WebSocket implementation for real-time communication

### Development and Build Tools
- **vite**: Build tool and development server
- **esbuild**: Fast JavaScript bundler for production builds
- **tsx**: TypeScript execution engine for development
- **tailwindcss**: Utility-first CSS framework
- **postcss**: CSS post-processor

The architecture is designed for scalability with clear separation of concerns, type safety throughout the stack, and real-time capabilities for enhanced user experience.