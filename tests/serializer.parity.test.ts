// The Python app's own output (scripts/make_golden.py) is the specification:
// every case must come out byte-identical.
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { fromJson, projectFromJson, projectToJson, toJson } from '../src/core/model.ts'
import { serializeChapterBody, serializeDocument, serializeProjectMaster } from '../src/core/serializer.ts'

interface DocCase { document_json: string; tex: string; chapter_body: string }
interface ProjectCase { project_json: string; chapter_docs: string[]; master: string; master_nodocs: string }

const load = <T>(name: string): Record<string, T> =>
  JSON.parse(readFileSync(new URL(`./golden/${name}`, import.meta.url), 'utf-8'))

const docs = load<DocCase>('documents.json')
const projects = load<ProjectCase>('projects.json')

// "!ERROR <Name>" in the corpus means Python raised.
function same(actual: () => string, expected: string) {
  if (expected.startsWith('!ERROR')) {
    expect(actual).toThrow()
  } else {
    expect(actual()).toBe(expected)
  }
}

describe('document.json round-trips byte for byte', () => {
  it.each(Object.keys(docs))('%s', (name) => {
    expect(toJson(fromJson(docs[name].document_json))).toBe(docs[name].document_json)
  })
})

describe('LaTeX matches the Python serializer', () => {
  it.each(Object.keys(docs))('%s', (name) => {
    same(() => serializeDocument(fromJson(docs[name].document_json)), docs[name].tex)
  })
})

describe('chapter bodies match', () => {
  it.each(Object.keys(docs))('%s', (name) => {
    same(() => serializeChapterBody(fromJson(docs[name].document_json)), docs[name].chapter_body)
  })
})

describe('project masters match', () => {
  it.each(Object.keys(projects))('%s', (name) => {
    const c = projects[name]
    const proj = projectFromJson(c.project_json)
    expect(projectToJson(proj)).toBe(c.project_json)
    same(() => serializeProjectMaster(proj, c.chapter_docs.map(fromJson)), c.master)
    same(() => serializeProjectMaster(proj, []), c.master_nodocs)
  })
})
