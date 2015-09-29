import { Frame } from './environment';
import { ElementStack } from './builder';
import { Enumerable } from './utils';
import DOMHelper from './dom';
import Template from './template';
import { RenderResult } from './render';

export interface MorphSpecializer<InitOptions> {
  specialize(options: InitOptions): MorphConstructor<InitOptions>;
}

export interface ContentMorphSpecializer<InitOptions> {
  specialize(options: InitOptions): ContentMorphConstructor<InitOptions>;
}

export interface MorphConstructor<InitOptions> extends MorphSpecializer<InitOptions> {
  new (parentNode: Element, frame: Frame): Morph;
}

export interface MorphClass<M extends Morph> {
  new (parentNode: Element, frame: Frame): M;
  specialize<N extends M>(options: any): MorphClass<N>;
}

export interface ContentMorphConstructor<InitOptions> extends ContentMorphSpecializer<InitOptions> {
  new (parentNode: Element, frame: Frame): ContentMorph;
}

export interface HasParentNode {
  parentNode: Element;
}

export interface InitableMorph<InitOptions> extends Morph {
  init(options: InitOptions);
}

export abstract class Morph implements HasParentNode {
  static specialize<InitOptions>(options: InitOptions): MorphConstructor<InitOptions> {
    return <MorphConstructor<InitOptions>>this;
  }

  public parentNode: Element;
  public frame: Frame;

  constructor(parentNode: Element, frame: Frame) {
    this.frame = frame;

    // public, used by Builder
    this.parentNode = parentNode; // public, used by Builder
  }

  parentElement() {
    return this.parentNode;
  }

  init(options: Object) {}

  /**
    This method gets called during the initial render process. A morph should
    append its contents to the stack.
  */
  abstract append(stack: ElementStack);

  /**
    This method gets called during rerenders. A morph is responsible for
    detecting that no work needs to be done, or updating its bounds based
    on changes to input references.

    It is also responsible for managing its own bounds.
  */
  abstract update();

  /**
    This method gets called when a parent list is being cleared, which means
    that the area of DOM that this morph represents will not exist anymore.

    The morph should destroy its input reference (a forked reference or other
    composed reference).

    Normally, you don't need to manage DOM teardown here because the parent
    morph that contains this one will clear the DOM all at once. However,
    if the morph type supports being moved (a "wormhole"), then it will need
    to remember that it was moved and clear the DOM here.
  */
  destroy() {}
}

export abstract class ContentMorph extends Morph implements Bounds {
  static specialize<InitOptions>(options: InitOptions): ContentMorphConstructor<InitOptions> {
    return <ContentMorphConstructor<InitOptions>>this;
  }

  parentElement() {
    return this.parentNode;
  }

  abstract firstNode(): Node;
  abstract lastNode(): Node;
}

export abstract class EmptyableMorph extends ContentMorph implements Bounds {
  private comment: boolean = false;
  private bounds: Bounds = null;
  public currentOperations: EmptyableMorphOperations = new Appending(this, this.frame.dom());

  firstNode() {
    return this.currentOperations.firstNode();
  }

  lastNode() {
    return this.currentOperations.lastNode();
  }

  nextSibling() {
    return this.lastNode().nextSibling;
  }

  protected didBecomeEmpty() {
    this.currentOperations.didBecomeEmpty();
  }

  protected nextSiblingForContent(): Node {
    return this.currentOperations.nextSiblingForContent();
  }

  protected didInsertContent(bounds: Bounds) {
    this.currentOperations.didInsertContent(bounds);
  }
}

abstract class EmptyableMorphOperations {
  protected parent: EmptyableMorph;
  protected dom: DOMHelper;

  constructor(parent: EmptyableMorph, dom: DOMHelper) {
    this.parent = parent;
    this.dom = dom;
  }

  abstract firstNode(): Node;
  abstract lastNode(): Node;
  abstract didBecomeEmpty();
  abstract nextSiblingForContent(): Node;
  abstract didInsertContent(bounds: Bounds);
}

class Appending extends EmptyableMorphOperations {
  firstNode() { return null; }
  lastNode() { return null; }

  didBecomeEmpty() {
    this.parent.currentOperations = new Empty(this.parent, this.dom, null);
  }

  nextSiblingForContent() { return null; }

  didInsertContent(bounds: Bounds) {
    this.parent.currentOperations = new HasContent(this.parent, this.dom, bounds);
  }
}

class Empty extends EmptyableMorphOperations {
  private comment: Comment;

  constructor(parent: EmptyableMorph, dom: DOMHelper, nextSibling: Node=null) {
    super(parent, dom);
    let comment = this.comment = dom.createComment('');
    dom.insertBefore(parent.parentNode, comment, nextSibling);
  }

  firstNode(): Node {
    return this.comment;
  }

  lastNode(): Node {
    return this.comment;
  }

  didBecomeEmpty() {}

  nextSiblingForContent(): Node {
    return this.comment;
  }

  didInsertContent(bounds: Bounds) {
    let { comment } = this;
    comment.parentNode.removeChild(comment);
    this.parent.currentOperations = new HasContent(this.parent, this.dom, bounds);
  }
}

class HasContent extends EmptyableMorphOperations {
  private bounds: Bounds;

  constructor(parent: EmptyableMorph, dom: DOMHelper, bounds: Bounds) {
    super(parent, dom);
    this.bounds = bounds;
  }

  firstNode(): Node {
    return this.bounds.firstNode();
  }

  lastNode(): Node {
    return this.bounds.lastNode();
  }

  didBecomeEmpty() {
    let nextSibling = clear(this.bounds);
    this.parent.currentOperations = new Empty(this.parent, this.dom, nextSibling);
  }

  nextSiblingForContent(): Node {
    return this.bounds.firstNode();
  }

  didInsertContent(bounds: Bounds) {
    clear(this.bounds);
    this.bounds = bounds;
  }
}

export abstract class TemplateMorph extends EmptyableMorph {
  protected lastResult: RenderResult;

  firstNode(): Node {
    if (this.lastResult) return this.lastResult.firstNode();
    return super.firstNode();
  }

  lastNode(): Node {
    if (this.lastResult) return this.lastResult.lastNode();
    return super.lastNode();
  }

  appendTemplate(template: Template, nextSibling: Node=null) {
    let result = this.lastResult = template.evaluate(this, nextSibling);
    this.didInsertContent(result);
  }

  updateTemplate(template: Template) {
    let { lastResult } = this;

    if (!lastResult) {
      let nextSibling = this.nextSiblingForContent();
      this.appendTemplate(template, nextSibling);
      return;
    }

    if (template === lastResult.template) {
      lastResult.rerender();
    } else {
      let nextSibling = this.nextSiblingForContent();
      this.appendTemplate(template, nextSibling);
    }
  }

  didBecomeEmpty() {
    super.didBecomeEmpty();
    this.lastResult = null;
  }
}

export interface Bounds {
  // a method to future-proof for wormholing; may not be needed ultimately
  parentElement(): Element;
  firstNode(): Node;
  lastNode(): Node;
}

export function bounds(parent: Element, first: Node, last: Node): Bounds {
  return new ConcreteBounds(parent, first, last);
}

export function appendBounds(parent: Element): Bounds {
  return new ConcreteBounds(parent, null, null);
}

export class ConcreteBounds implements Bounds {
  public parentNode: Element;
  private first: Node;
  private last: Node;

  constructor(parent: Element, first: Node, last: Node) {
    this.parentNode = parent;
    this.first = first;
    this.last = last;
  }

  parentElement() { return this.parentNode; }
  firstNode() { return this.first; }
  lastNode() { return this.last; }
}

export class SingleNodeBounds implements Bounds {
  private parentNode: Element;
  private node: Node;

  constructor(parentNode: Element, node: Node) {
    this.parentNode = parentNode;
    this.node = node;
  }

  parentElement() { return this.parentNode; }
  firstNode() { return this.node; }
  lastNode() { return this.node; }
}

export function initializeMorph<M extends Morph, InitOptions>(Type: MorphClass<M>, attrs: InitOptions, parentElement: Element, frame: Frame): M {
  let SpecializedType = Type.specialize(attrs);
  let morph = new SpecializedType(parentElement, frame);
  morph.init(attrs);
  return <M>morph;
}

export function clearWithComment(bounds: Bounds, dom: DOMHelper) {
  let nextSibling = clear(bounds);
  let parent = bounds.parentElement();
  let comment = dom.createComment('');
  dom.insertBefore(bounds.parentElement(), comment, nextSibling);
  return new ConcreteBounds(parent, comment, comment);
}

export function insertBoundsBefore(parent: Element, bounds: Bounds, reference: Bounds, dom: DOMHelper) {
  let first = bounds.firstNode();
  let last = bounds.lastNode();
  let nextSibling = reference ? reference.firstNode() : null;

  let current = first;

  while (current) {
    dom.insertBefore(parent, current, nextSibling);
    if (current === last) break;
    current = current.nextSibling;
  }
}

export function renderIntoBounds(template: Template, bounds: Bounds, morph: ContentMorph) {
  let nextSibling = clear(bounds);
  return template.evaluate(morph, nextSibling);
}

export function clear(bounds: Bounds) {
  let parent = bounds.parentElement();
  let first = bounds.firstNode();
  let last = bounds.lastNode();

  let node = first;

  while (node) {
    let next = node.nextSibling;
    parent.removeChild(node);
    if (node === last) return next;
    node = next;
  }

  return null;
}