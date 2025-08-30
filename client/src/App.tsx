import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Layout } from "@/components/Layout";
import Dashboard from "@/pages/Dashboard";
import DeployBot from "@/pages/DeployBot";
import LiveLogs from "@/pages/LiveLogs";
import DeploymentGuide from "@/pages/DeploymentGuide";
import TelegramBotManager from "@/pages/TelegramBotManager";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/deploy" component={DeployBot} />
      <Route path="/logs" component={LiveLogs} />
      <Route path="/guide" component={DeploymentGuide} />
      <Route path="/telegram" component={TelegramBotManager} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Layout>
          <Toaster />
          <Router />
        </Layout>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
