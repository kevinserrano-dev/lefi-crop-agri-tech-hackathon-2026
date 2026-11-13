import { DashboardPage } from '../features/dashboard/DashboardPage';
import { IncidentsPage } from '../features/incidents/IncidentsPage';
import { DevicesPage } from '../features/devices/DevicesPage';
import { EnvironmentPage } from '../features/environment/EnvironmentPage';
import { EnvironmentLive } from '../features/environment/EnvironmentLive';
import { PlantHealthPage } from '../features/plant-health/PlantHealthPage';
import { TasksPage } from '../features/tasks/TasksPage';
import { TasksLive } from '../features/tasks-live/TasksLive';
import { AiControlPage } from '../features/ai-control/AiControlPage';
import { AiControlLive } from '../features/ai-control/AiControlLive';
import { KnowledgeNotInMock, KnowledgeRoute } from '../features/knowledge/KnowledgeLive';
import { RobotsPage } from '../features/robots/RobotsPage';
import { RobotsLive } from '../features/robots-live/RobotsLive';
import { HandoverPage } from '../features/handover/HandoverPage';
import { HandoverLive } from '../features/handover/HandoverLive';
import { EscalationPage } from '../features/escalation/EscalationPage';
import { EscalationLive } from '../features/escalation/EscalationLive';
import { WorkforcePage } from '../features/workforce/WorkforcePage';
import { AdminPage } from '../features/admin/AdminPage';
import { CropsPage } from '../features/crops/CropsPage';
import { ZonesPage } from '../features/zones/ZonesPage';
import { FieldDevicesLive } from '../features/live/FieldDevicesLive';
import { PlantsLive } from '../features/live/PlantsLive';
import { ZonesLive } from '../features/live/ZonesLive';
import { AlertsRoute } from '../features/alerts-live/AlertsLive';
import { DashboardLive } from '../features/operations/DashboardLive';
import { PlantHealthLive } from '../features/operations/PlantHealthLive';
import { AdminLive } from '../features/people/AdminLive';
import { WorkforceLive } from '../features/people/WorkforceLive';
import type { ScreenDef } from './screen';
import { screenPath } from './screenPath';

/**
 * Screens of the Lefi Crop admin design ("Lefi Crop AI Main").
 * Adding a screen = adding one entry. Permission ids follow the design's RBAC matrix and
 * are provisional until the Brain defines its catalogue.
 */
export const screens: ScreenDef[] = [
  {
    id: 'dashboard',
    brain: { endpoint: '/dashboard', module: 'telemetry, plants and alerts' },
    live: { endpoint: '/overview', component: DashboardLive },
    path: '/',
    label: 'Dashboard',
    icon: 'space_dashboard',
    group: 'Operations',
    permission: 'nav.dashboard',
    title: 'Executive Dashboard',
    subtitle: 'Operational overview · all greenhouses',
    component: DashboardPage,
  },
  {
    id: 'greenhouses',
    brain: { endpoint: '/views/greenhouses', module: 'plants (crop batches, health)' },
    live: { endpoint: '/plants', component: PlantsLive },
    path: screenPath('greenhouses'),
    label: 'Greenhouses & Crops',
    icon: 'potted_plant',
    group: 'Operations',
    permission: 'nav.greenhouses',
    title: 'Greenhouses & Crops',
    subtitle: 'Greenhouse → Zone → Crop batch → Plant',
    component: CropsPage,
  },
  {
    id: 'zones',
    brain: { endpoint: '/inventory/zones', module: 'plants and field devices' },
    live: { endpoint: '/inventory-items', component: ZonesLive },
    path: screenPath('zones'),
    label: 'Zones & Inventory',
    icon: 'grid_view',
    group: 'Operations',
    permission: 'nav.zones',
    title: 'Zones & Inventory',
    subtitle: 'Zone setup, assigned devices, robots, crew and maintenance',
    component: ZonesPage,
  },
  {
    id: 'environment',
    brain: { endpoint: '/environment/zones', module: 'MQTT telemetry ingestion' },
    live: { endpoint: '/environment', component: EnvironmentLive },
    path: screenPath('environment'),
    label: 'Environment',
    icon: 'sensors',
    group: 'Operations',
    permission: 'nav.environment',
    title: 'Environmental Monitoring',
    subtitle: 'Real-time IoT sensors and operating ranges',
    component: EnvironmentPage,
  },
  {
    id: 'plantHealth',
    brain: {
      endpoint: '/detections',
      module: 'AI plant health (zone reviews; no per-plant vision)',
    },
    live: { endpoint: '/plant-health', component: PlantHealthLive },
    path: screenPath('plantHealth'),
    label: 'AI Plant Health',
    icon: 'psychiatry',
    group: 'Operations',
    permission: 'nav.plantHealth',
    title: 'AI Plant Health',
    subtitle: 'Computer-vision detections and human review',
    component: PlantHealthPage,
  },
  {
    id: 'alerts',
    brain: { endpoint: '/incidents', module: 'rules engine and alerts' },
    live: { endpoint: '/alerts', component: AlertsRoute },
    path: screenPath('alerts'),
    label: 'Alerts & Incidents',
    icon: 'crisis_alert',
    group: 'Response center',
    permission: 'nav.alerts',
    title: 'Alerts & Incidents',
    subtitle: 'AI-detected and manually reported incidents',
    component: IncidentsPage,
  },
  {
    id: 'robots',
    brain: { endpoint: '/robots', module: 'robotics (simulated MH3)' },
    live: { endpoint: '/robots', component: RobotsLive },
    path: screenPath('robots'),
    label: 'Robot Mission Center',
    icon: 'smart_toy',
    group: 'Response center',
    permission: 'nav.robots',
    title: 'Autonomous Robot Mission Center',
    subtitle: 'Simulated robot · missions, live views and command log',
    component: RobotsPage,
  },
  {
    id: 'tasks',
    brain: { endpoint: '/tasks', module: 'tasks and work orders' },
    live: { endpoint: '/tasks', component: TasksLive },
    path: screenPath('tasks'),
    label: 'Tasks & Work Orders',
    icon: 'task_alt',
    group: 'Response center',
    permission: 'nav.tasks',
    title: 'Tasks & Work Orders',
    subtitle: 'AI-generated and human-assigned work',
    component: TasksPage,
  },
  {
    id: 'handover',
    brain: { endpoint: '/handover/current', module: 'shifts and handover' },
    live: { endpoint: '/handover/current', component: HandoverLive },
    path: screenPath('handover'),
    label: 'Shift Handover',
    icon: 'sync_alt',
    group: 'Response center',
    permission: 'nav.handover',
    title: 'Shift Handover',
    subtitle: 'Outgoing shift → incoming shift',
    component: HandoverPage,
  },
  {
    id: 'escalation',
    brain: { endpoint: '/escalation', module: 'notifications and escalation' },
    live: { endpoint: '/escalation/preview', component: EscalationLive },
    path: screenPath('escalation'),
    label: 'Escalation Rules',
    icon: 'campaign',
    group: 'Response center',
    permission: 'nav.escalation',
    title: 'Escalation Rules',
    subtitle: 'Notification routing, acknowledgement and escalation audit',
    component: EscalationPage,
  },
  {
    id: 'devices',
    brain: { endpoint: '/devices', module: 'field devices (ESP32 registration)' },
    live: { endpoint: '/field-devices', component: FieldDevicesLive },
    path: screenPath('devices'),
    label: 'Devices & Health',
    icon: 'device_hub',
    group: 'Control & safety',
    permission: 'nav.devices',
    title: 'Devices & Health',
    subtitle:
      'Sensors, cameras, actuators, robots & drones · health, location, power and AI access',
    component: DevicesPage,
  },
  {
    id: 'aiControl',
    brain: { endpoint: '/ai/control', module: 'AI gateway and kill switch over HTTP' },
    live: { endpoint: '/ai/control', component: AiControlLive },
    path: screenPath('aiControl'),
    label: 'AI Control & Safety',
    icon: 'shield',
    group: 'Control & safety',
    permission: 'nav.aiControl',
    title: 'AI Control & Safety',
    subtitle: 'Emergency stop, manual mode, autonomy policy and AI settings',
    component: AiControlPage,
  },
  {
    id: 'knowledge',
    brain: { endpoint: '/knowledge', module: 'AI Knowledge Center (real Lefi Brain only)' },
    live: { endpoint: '/knowledge/profiles', component: KnowledgeRoute },
    path: screenPath('knowledge'),
    label: 'AI Knowledge Center',
    icon: 'menu_book',
    group: 'Control & safety',
    permission: 'nav.knowledge',
    title: 'AI Knowledge Center',
    subtitle: 'Crop profiles, parameters, documents and rules Lefi Brain should know',
    component: KnowledgeNotInMock,
  },
  {
    id: 'workforce',
    brain: {
      endpoint: '/workforce/people',
      module: 'shifts and availability (people come from user management)',
    },
    live: { endpoint: '/users', component: WorkforceLive },
    path: screenPath('workforce'),
    label: 'Workforce',
    icon: 'groups',
    group: 'People & System',
    permission: 'nav.workforce',
    title: 'Workforce',
    subtitle: 'Directory, shifts and availability',
    component: WorkforcePage,
  },
  {
    id: 'admin',
    brain: {
      endpoint: '/admin/permissions',
      module: 'system configuration over HTTP',
    },
    live: { endpoint: '/audit', component: AdminLive },
    path: screenPath('admin'),
    label: 'Administration',
    icon: 'admin_panel_settings',
    group: 'People & System',
    permission: 'nav.admin',
    title: 'Administration',
    subtitle: 'Roles, devices, configuration and audit',
    component: AdminPage,
  },
];
