import { BookOpen, ChartColumn, CookingPot, LayoutDashboard, MessageSquareText, Receipt, Refrigerator, ScrollText, Settings, Users } from 'lucide-react';

export const navigation = [
  { label: 'Workspace', items: [
    { to: '/', label: 'Dashboard', icon: LayoutDashboard },
    { to: '/food', label: 'Pantry', icon: Refrigerator },
    { to: '/recipes', label: 'Recipes', icon: CookingPot },
    { to: '/cookbook', label: 'Cookbook', icon: BookOpen },
    { to: '/users', label: 'Users', icon: Users },
    { to: '/feedback', label: 'Feedback', icon: MessageSquareText },
  ] },
  { label: 'Insights', items: [
    { to: '/analytics', label: 'Food outcomes', icon: ChartColumn },
    { to: '/costs', label: 'API costs', icon: Receipt },
  ] },
  { label: 'System', items: [
    { to: '/logs', label: 'System logs', icon: ScrollText },
  ] },
];

export const settingsItem = { to: '/settings', label: 'Settings', icon: Settings };
