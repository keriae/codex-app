import { describe, expect, it } from 'vitest'
import type { AppContext } from '../../shared/api'
import type { Project } from './protocol'
import { canRestoreInitialProject, initialProjectPath, localThreadProjectKind, parseSelectedProject, rememberSelectedProject, rememberSelectedWorkspace, SELECTED_PROJECT_KEY } from './selectedProject'

const context: AppContext = {cwd: '/Users/test', folderName: 'test', branch: null, platform: 'darwin', initialCwdSource: 'home'}
const project = (path: string): Project => ({id:path, name:path, roots:[{path}], metadata:{}, position:0, createdAt:0, updatedAt:0, recencyAt:null})
const catalog = [project('/first'), project('/second')]

describe('selected local project startup', () => {
  it('uses the first ordered local project on first launch', () => {
    expect(initialProjectPath(context, catalog, parseSelectedProject(null))).toBe('/first')
  })
  it('restores a selected root, including a secondary root', () => {
    expect(initialProjectPath(context, [{...catalog[0], roots:[{path:'/first'}, {path:'/secondary'}]}], parseSelectedProject('"/secondary/"'))).toBe('/secondary')
  })
  it('retains an explicit projectless selection', () => {
    expect(initialProjectPath(context, catalog, parseSelectedProject('null'))).toBeNull()
  })
  it('falls back in catalog order when a selected project was removed', () => {
    expect(initialProjectPath(context, catalog, parseSelectedProject('"/removed"'))).toBe('/first')
  })
  it('does not override a launch cwd, even an explicit root cwd', () => {
    for (const source of ['argument', 'environment', 'process', undefined] as const) {
      expect(initialProjectPath({...context, cwd:'/', initialCwdSource:source}, catalog, parseSelectedProject('"/second"'))).toBeNull()
    }
  })
  it('ignores volume roots, corrupt storage and empty catalogs', () => {
    expect(initialProjectPath(context, [project('/'), project('/second')], parseSelectedProject('invalid'))).toBe('/second')
    expect(initialProjectPath(context, [], parseSelectedProject('"/second"'))).toBeNull()
    expect(parseSelectedProject('"relative"')).toEqual({stored:false})
  })
  it('cannot apply a late response after navigation, submission or draft replacement', () => {
    const expected = {revision:1, scope:'draft:one'}
    const current = {...expected, selectedThreadId:null, activeSubmissionId:null}
    expect(canRestoreInitialProject(expected, current)).toBe(true)
    for (const change of [{revision:2}, {scope:'draft:two'}, {selectedThreadId:'thread'}, {activeSubmissionId:'turn'}]) {
      expect(canRestoreInitialProject(expected, {...current,...change})).toBe(false)
    }
  })
  it('persists successful selections independently of original app storage', () => {
    const values = new Map<string,string>()
    const storage = {setItem:(key:string,value:string) => {values.set(key,value)}}
    rememberSelectedProject(storage, '/second/')
    expect(values.get(SELECTED_PROJECT_KEY)).toBe('"/second"')
    rememberSelectedProject(storage, '/')
    expect(values.get(SELECTED_PROJECT_KEY)).toBe('"/second"')
    rememberSelectedProject(storage, null)
    expect(values.get(SELECTED_PROJECT_KEY)).toBe('null')
    expect(() => rememberSelectedProject({setItem:() => {throw Error('unavailable')}}, '/second')).not.toThrow()
  })
  it('round-trips remote and projectless workspace selections', () => {
    const values = new Map<string,string>()
    const storage = {setItem:(key:string,value:string) => {values.set(key,value)}}
    rememberSelectedWorkspace(storage, {
      kind:'remote', hostId:'remote-ssh-codex-managed:host', projectId:'project-1', path:'/srv/repo/'
    })
    expect(parseSelectedProject(values.get(SELECTED_PROJECT_KEY)!)).toEqual({
      stored:true,
      path:'/srv/repo',
      target:{kind:'remote', hostId:'remote-ssh-codex-managed:host', projectId:'project-1', path:'/srv/repo'}
    })
    rememberSelectedWorkspace(storage, {kind:'projectless', path:'/Users/test/Documents/Codex'})
    expect(parseSelectedProject(values.get(SELECTED_PROJECT_KEY)!)).toEqual({
      stored:true,
      path:null,
      target:{kind:'projectless', path:'/Users/test/Documents/Codex'}
    })
    expect(parseSelectedProject('{"kind":"projectless","path":"relative"}')).toEqual({stored:false})
  })

  it('reopens uncatalogued local threads as projectless chats', () => {
    expect(localThreadProjectKind({cwd:'/first', projectId:null}, catalog, [])).toBe('local')
    expect(localThreadProjectKind({cwd:'/saved', projectId:null}, [], ['/saved/'])).toBe('local')
    expect(localThreadProjectKind({cwd:'/standalone', projectId:null}, catalog, [])).toBe('projectless')
    expect(localThreadProjectKind({cwd:'/moved', projectId:'/first'}, catalog, [])).toBe('local')
  })
})
