const ROUTE_FILES = {
  '+page.svelte': 'page',
  '+page.server.js': 'page',
  '+page.server.ts': 'page',
  '+page.js': 'page',
  '+page.ts': 'page',
  '+server.js': 'api',
  '+server.ts': 'api',
  '+layout.svelte': 'layout',
  '+layout.server.js': 'layout',
  '+layout.server.ts': 'layout',
  '+layout.js': 'layout',
  '+layout.ts': 'layout',
  '+error.svelte': 'error',
};

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

function extractRoutePath(filePath) {
  // routes/api/users/[id]/+server.js -> /api/users/:id
  const match = filePath.match(/(?:^|.*\/)routes\/(.*?)\/\+/);
  if (!match) return '/';

  let route = '/' + match[1];

  // convert SvelteKit params to standard notation
  route = route.replace(/\[\.\.\.(\w+)\]/g, '*$1');    // [...rest] -> *rest
  route = route.replace(/\[(\w+)\]/g, ':$1');           // [id] -> :id

  // groups like (app) should be removed from the path
  route = route.replace(/\/\([^)]+\)/g, '');

  return route || '/';
}

function extractParams(routePath) {
  const params = [];
  const paramRegex = /:(\w+)/g;
  let m;
  while ((m = paramRegex.exec(routePath)) !== null) {
    params.push(m[1]);
  }
  // catch-all params
  const catchAll = routePath.match(/\*(\w+)/g);
  if (catchAll) {
    params.push(...catchAll.map(p => p.slice(1)));
  }
  return params;
}

function detectHttpMethods(content) {
  const methods = [];
  for (const method of HTTP_METHODS) {
    // match: export const GET = ..., export function GET(, export async function GET(
    const pattern = new RegExp(`export\\s+(?:const|let|function|async\\s+function)\\s+${method}\\b`);
    if (pattern.test(content)) {
      methods.push(method);
    }
  }
  return methods;
}

function hasLoadFunction(content) {
  return /export\s+(?:const|let|function|async\s+function)\s+load\b/.test(content);
}

function hasActionsExport(content) {
  return /export\s+const\s+actions\b/.test(content);
}

export function analyzeSvelteKitRoutes(files, analyzedFiles) {
  const routes = [];

  for (const file of files) {
    const fileName = file.path.split('/').pop();
    const routeType = ROUTE_FILES[fileName];
    if (!routeType) continue;

    // must be under routes/ (path may or may not include src/ prefix depending on scan root)
    if (!file.path.match(/(?:^|\/)routes\//)) continue;

    const routePath = extractRoutePath(file.path);
    const params = extractParams(routePath);
    const content = file.content || '';

    const route = {
      path: routePath,
      file: file.path,
      type: routeType,
      methods: [],
      hasLoad: false,
      hasActions: false,
      params,
    };

    if (routeType === 'api') {
      route.methods = detectHttpMethods(content);
    }

    if (fileName.includes('server')) {
      route.hasLoad = hasLoadFunction(content);
      route.hasActions = hasActionsExport(content);
    }

    routes.push(route);
  }

  // sort by path for consistent output
  routes.sort((a, b) => a.path.localeCompare(b.path));
  return routes;
}
