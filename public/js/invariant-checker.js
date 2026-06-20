'use strict';

const TECH_REQUEST_WORDS = /(?:напиши|сделай|реализуй|создай|разработай|написать|сделать|реализовать|создать|разработать|код|функция|класс|компонент|сервис|модуль|интерфейс|решение|алгоритм|архитектур)/i;

const CODE_INDICATORS = /```|\bfunction\b|\bclass\b|\bconst\b|\blet\b|\bimport\b|\bexport\b|\bdef\b|\bpublic\b|\bprivate\b|\bvar\b|\bval\b|\bfun\b|\binterface\b|\btrait\b|\benum\b|\bextends\b|\bimplements\b|\breturn\b|\bthrow\b|=>|->|\.\w+\(/i;

const TECH_PATTERNS = [
  { name: 'java', pattern: /\bjava\b/i, exclude: [/\bjavascript\b/i], aliases: [] },
  { name: 'javascript', pattern: /\bjavascript\b|\bjs\b/i, exclude: [], aliases: ['js'] },
  { name: 'python', pattern: /\bpython\b/i, exclude: [], aliases: [] },
  { name: 'kotlin', pattern: /\bkotlin\b/i, exclude: [], aliases: [] },
  { name: 'swift', pattern: /\bswift\b/i, exclude: [], aliases: [] },
  { name: 'typescript', pattern: /\btypescript\b|\bts\b/i, exclude: [], aliases: ['ts'] },
  { name: 'go', pattern: /\bgo\b/i, exclude: [], aliases: [] },
  { name: 'rust', pattern: /\brust\b/i, exclude: [], aliases: [] },
  { name: 'cpp', pattern: /\bc\+\+(?!\w)/i, exclude: [], aliases: ['c++'] },
  { name: 'csharp', pattern: /\bc#(?!\w)/i, exclude: [], aliases: ['c#'] },
  { name: 'ruby', pattern: /\bruby\b/i, exclude: [], aliases: [] },
  { name: 'php', pattern: /\bphp\b/i, exclude: [], aliases: [] },
  { name: 'scala', pattern: /\bscala\b/i, exclude: [], aliases: [] },
  { name: 'dart', pattern: /\bdart\b/i, exclude: [], aliases: [] },
  { name: 'lua', pattern: /\blua\b/i, exclude: [], aliases: [] },
  { name: 'haskell', pattern: /\bhaskell\b/i, exclude: [], aliases: [] },
  { name: 'react', pattern: /\breact\b/i, exclude: [], aliases: [] },
  { name: 'angular', pattern: /\bangular\b/i, exclude: [], aliases: [] },
  { name: 'vue', pattern: /\bvue\b/i, exclude: [], aliases: [] },
  { name: 'spring', pattern: /\bspring\b/i, exclude: [], aliases: [] },
  { name: 'django', pattern: /\bdjango\b/i, exclude: [], aliases: [] },
  { name: 'flask', pattern: /\bflask\b/i, exclude: [], aliases: [] },
  { name: 'express', pattern: /\bexpress\b/i, exclude: [], aliases: [] },
  { name: 'ktor', pattern: /\bktor\b/i, exclude: [], aliases: [] },
  { name: 'mvvm', pattern: /\bmvvm\b/i, exclude: [], aliases: [] },
  { name: 'mvi', pattern: /\bmvi\b/i, exclude: [], aliases: [] },
  { name: 'mvp', pattern: /\bmvp\b/i, exclude: [], aliases: [] },
  { name: 'mvc', pattern: /\bmvc\b/i, exclude: [], aliases: [] },
  { name: 'clean_architecture', pattern: /\bclean\s+architecture\b/i, exclude: [], aliases: ['clean architecture'] },
  { name: 'redux', pattern: /\bredux\b/i, exclude: [], aliases: [] },
  { name: 'flux', pattern: /\bflux\b/i, exclude: [], aliases: [] },
  { name: 'viewmodel', pattern: /\bviewmodel\b|\bview\s+model\b/i, exclude: [], aliases: ['view model'] },
  { name: 'activity', pattern: /\bactivity\b/i, exclude: [], aliases: [] },
  { name: 'fragment', pattern: /\bfragment\b/i, exclude: [], aliases: [] },
  { name: 'compose', pattern: /\bcompose\b|\bjetpack\s+compose\b/i, exclude: [], aliases: ['jetpack compose'] },
  { name: 'swiftui', pattern: /\bswiftui\b/i, exclude: [], aliases: [] },
  { name: 'tdd', pattern: /\btdd\b/i, exclude: [], aliases: [] },
  { name: 'bdd', pattern: /\bbdd\b/i, exclude: [], aliases: [] },
  { name: 'ddd', pattern: /\bddd\b/i, exclude: [], aliases: [] },
  { name: 'rest', pattern: /\brest\b/i, exclude: [], aliases: [] },
  { name: 'graphql', pattern: /\bgraphql\b/i, exclude: [], aliases: [] },
  { name: 'grpc', pattern: /\bgrpc\b/i, exclude: [], aliases: [] },
  { name: 'docker', pattern: /\bdocker\b/i, exclude: [], aliases: [] },
  { name: 'kubernetes', pattern: /\bkubernetes\b|\bk8s\b/i, exclude: [], aliases: ['k8s'] },
  { name: 'aws', pattern: /\baws\b/i, exclude: [], aliases: [] },
  { name: 'azure', pattern: /\bazure\b/i, exclude: [], aliases: [] },
  { name: 'gcp', pattern: /\bgcp\b/i, exclude: [], aliases: [] },
  { name: 'postgres', pattern: /\bpostgres\b|\bpostgresql\b/i, exclude: [], aliases: ['postgresql'] },
  { name: 'mysql', pattern: /\bmysql\b/i, exclude: [], aliases: [] },
  { name: 'mongodb', pattern: /\bmongodb\b|\bmongo\b/i, exclude: [], aliases: ['mongo'] },
  { name: 'redis', pattern: /\bredis\b/i, exclude: [], aliases: [] },
  { name: 'node', pattern: /\bnode\b(?!\s*\.\s*js)/i, exclude: [/\bnode\.js\b/i], aliases: ['nodejs'] },
  { name: 'deno', pattern: /\bdeno\b/i, exclude: [], aliases: [] },
  { name: 'svelte', pattern: /\bsvelte\b/i, exclude: [], aliases: [] },
  { name: 'nextjs', pattern: /\bnext\s*\.?\s*js\b|\bnextjs\b/i, exclude: [], aliases: ['next.js', 'nextjs'] },
  { name: 'nuxt', pattern: /\bnuxt\b/i, exclude: [], aliases: [] },
  { name: 'dagger', pattern: /\bdagger\b/i, exclude: [], aliases: [] },
  { name: 'hilt', pattern: /\bhilt\b/i, exclude: [], aliases: [] },
  { name: 'retrofit', pattern: /\bretrofit\b/i, exclude: [], aliases: [] },
  { name: 'rxjava', pattern: /\brxjava\b/i, exclude: [], aliases: [] },
  { name: 'rxswift', pattern: /\brxswift\b/i, exclude: [], aliases: [] },
  { name: 'combine', pattern: /\bcombine\b/i, exclude: [], aliases: [] },
  { name: 'coroutine', pattern: /\bcoroutine\b|\bcoroutines\b/i, exclude: [], aliases: ['coroutines'] },
  { name: 'flow', pattern: /\bflow\b/i, exclude: [], aliases: [] },
  { name: 'databinding', pattern: /\bdatabinding\b|\bdata\s+binding\b/i, exclude: [], aliases: ['data binding'] },
  { name: 'jetpack', pattern: /\bjetpack\b/i, exclude: [], aliases: [] },
  { name: 'react_native', pattern: /\breact\s+native\b/i, exclude: [], aliases: ['react native'] },
  { name: 'flutter', pattern: /\bflutter\b/i, exclude: [], aliases: [] },
];

const RULE_RELATED_TERMS = {
  mvi: ['viewmodel', 'intent', 'state', 'reducer', 'model', 'view', 'effect', 'sideeffect', 'store'],
  mvvm: ['viewmodel', 'databinding', 'binding', 'observable', 'livedata', 'stateflow', 'databinding'],
  mvp: ['presenter', 'contract', 'view', 'interactor'],
  redux: ['store', 'reducer', 'action', 'dispatch', 'selector'],
  'clean architecture': ['usecase', 'repository', 'entity', 'domain', 'datasource'],
};

class InvariantChecker {
  constructor(memoryManager) {
    this.memoryManager = memoryManager;
    this._synonyms = {};
    for (const [key, terms] of Object.entries(RULE_RELATED_TERMS)) {
      const lower = key.toLowerCase();
      this._synonyms[lower] = terms;
      for (const term of terms) {
        if (!this._synonyms[term]) this._synonyms[term] = [key, ...terms.filter(t => t !== term)];
      }
    }
  }

  _parseItems(text) {
    return text.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  }

  _isTechnical(message) {
    return TECH_REQUEST_WORDS.test(message);
  }

  _containsCode(text) {
    return CODE_INDICATORS.test(text);
  }

  _findMentionedTech(text) {
    const names = [];
    for (const { name, pattern, exclude } of TECH_PATTERNS) {
      pattern.lastIndex = 0;
      let m;
      while ((m = pattern.exec(text)) !== null) {
        let excluded = false;
        if (exclude && exclude.length > 0) {
          for (const exPat of exclude) {
            exPat.lastIndex = m.index;
            if (exPat.test(text)) { excluded = true; break; }
          }
        }
        if (!excluded) {
          names.push(name);
        }
      }
    }
    return [...new Set(names)];
  }

  _isRelatedToRule(mentionedTech, ruleItems) {
    for (const tech of mentionedTech) {
      for (const rule of ruleItems) {
        const ruleLower = rule.toLowerCase();
        if (tech === ruleLower) return true;
        const synonyms = this._synonyms[ruleLower];
        if (synonyms && synonyms.includes(tech)) return true;
      }
    }
    return false;
  }

  _makeSafePattern(item) {
    const escaped = item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return '\\b' + escaped + '(?!\\w)';
  }

  checkRequest(userMessage) {
    const invariants = this.memoryManager.getLongTermDraft();
    const isTechnical = this._isTechnical(userMessage);

    if (invariants.prohibitions) {
      const prohibitions = this._parseItems(invariants.prohibitions);
      for (const item of prohibitions) {
        const pattern = this._makeSafePattern(item);
        if (new RegExp(pattern, 'i').test(userMessage)) {
          return { passed: false, reason: `запрещённая технология/подход: "${item}"` };
        }
      }
    }

    if (invariants.stack && isTechnical) {
      const stackItems = this._parseItems(invariants.stack);
      if (stackItems.length > 0) {
        const mentionedTech = this._findMentionedTech(userMessage);
        if (mentionedTech.length > 0) {
          for (const tech of mentionedTech) {
            const inStack = stackItems.some(s => {
              const sl = s.toLowerCase();
              return tech === sl || tech.includes(sl) || sl.includes(tech);
            });
            if (!inStack) {
              return { passed: false, reason: `запрошенная технология "${tech}" не соответствует утверждённому стеку (${invariants.stack})` };
            }
          }
        }
      }
    }

    if (invariants.rules && isTechnical) {
      const rulesItems = this._parseItems(invariants.rules);
      if (rulesItems.length > 0) {
        const mentionedTech = this._findMentionedTech(userMessage);
        const rulesMentioned = rulesItems.some(rule => {
          const pattern = this._makeSafePattern(rule);
          return new RegExp(pattern, 'i').test(userMessage);
        });
        if (!rulesMentioned) {
          if (mentionedTech.length > 0 && !this._isRelatedToRule(mentionedTech, rulesItems)) {
            return { passed: false, reason: `запрос не соответствует правилам проекта (ожидается: "${invariants.rules}")` };
          }
        }
      }
    }

    return { passed: true };
  }

  checkResponse(responseText) {
    const invariants = this.memoryManager.getLongTermDraft();
    const violations = [];

    if (invariants.prohibitions) {
      const prohibitions = this._parseItems(invariants.prohibitions);
      for (const item of prohibitions) {
        const pattern = this._makeSafePattern(item);
        if (new RegExp(pattern, 'i').test(responseText)) {
          violations.push(`упоминание запрещённого: "${item}"`);
        }
      }
    }

    if (invariants.stack) {
      const stackItems = this._parseItems(invariants.stack);
      if (stackItems.length > 0) {
        const mentionedTech = this._findMentionedTech(responseText);
        for (const tech of mentionedTech) {
          const inStack = stackItems.some(s => {
            const sl = s.toLowerCase();
            return tech === sl || tech.includes(sl) || sl.includes(tech);
          });
          if (!inStack) {
            const isProhibited = invariants.prohibitions && this._parseItems(invariants.prohibitions).some(p => {
              const pattern = this._makeSafePattern(p);
              return new RegExp(pattern, 'i').test(responseText);
            });
            if (!isProhibited) {
              violations.push(`использована технология "${tech}", не входящая в утверждённый стек`);
            }
          }
        }
      }
    }

    const hasCode = this._containsCode(responseText);
    if (hasCode && invariants.rules) {
      const rulesItems = this._parseItems(invariants.rules);
      if (rulesItems.length > 0) {
        const rulesMentioned = rulesItems.some(rule => {
          const pattern = this._makeSafePattern(rule);
          return new RegExp(pattern, 'i').test(responseText);
        });
        if (!rulesMentioned) {
          const mentionedTech = this._findMentionedTech(responseText);
          if (mentionedTech.length > 0 && !this._isRelatedToRule(mentionedTech, rulesItems)) {
            violations.push(`ответ не соответствует правилам (ожидается: "${invariants.rules}")`);
          }
        }
      }
    }

    if (violations.length > 0) {
      return { passed: false, violations };
    }

    return { passed: true };
  }
}

window.InvariantChecker = InvariantChecker;
