import type {SidebarsConfig} from '@docusaurus/plugin-content-docs';

const sidebars: SidebarsConfig = {
  docsSidebar: [
    'intro',
    {
      type: 'category',
      label: 'Getting Started',
      items: [
        'getting-started/installation',
        'getting-started/quickstart',
      ],
    },
    {
      type: 'category',
      label: 'Architecture',
      items: [
        'architecture/overview',
      ],
    },
    {
      type: 'category',
      label: 'Corail Runtime',
      items: [
        'corail/overview',
        'corail/configuration',
        'corail/llm-providers',
        'corail/storage',
        'corail/tools',
        'corail/importing-skills',
        'corail/strategies',
        'corail/channels',
        'corail/embeddings',
        'corail/guards',
        'corail/events',
        'corail/retrieval',
        'corail/agui',
      ],
    },
    {
      type: 'category',
      label: 'Récif Platform',
      items: [
        'recif/api',
        'recif/operator',
        'recif/helm',
        'recif/agent-settings',
        'recif/secret-management',
        'recif/evaluation',
      ],
    },
    {
      type: 'category',
      label: 'Marée Ingestion',
      items: [
        'maree/overview',
        'maree/pipeline',
      ],
    },
  ],
};

export default sidebars;
