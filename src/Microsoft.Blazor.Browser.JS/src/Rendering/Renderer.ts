﻿import { registerFunction } from '../RegisteredFunction';
import { System_Object, System_String, System_Array, MethodHandle } from '../Platform/Platform';
import { platform } from '../Environment';
import { getTreeNodePtr, renderTreeNode, NodeType, RenderTreeNodePointer } from './RenderTreeNode';
let raiseEventMethod: MethodHandle;
let getComponentRenderInfoMethod: MethodHandle;

// TODO: Instead of associating components to parent elements, associate them with a
// start/end node, so that components don't have to be enclosed in a wrapper
// TODO: To avoid leaking memory, automatically remove entries from this dict as soon
// as the corresponding DOM nodes are removed (or maybe when the associated component
// is disposed, assuming we can guarantee that always happens).
const componentIdToParentElement: { [componentId: string]: Element } = {};

registerFunction('_blazorAttachComponentToElement', attachComponentToElement);
registerFunction('_blazorRender', renderRenderTree);

function attachComponentToElement(elementSelector: System_String, componentId: System_String) {
  const elementSelectorJs = platform.toJavaScriptString(elementSelector);
  const element = document.querySelector(elementSelectorJs);
  if (!element) {
    throw new Error(`Could not find any element matching selector '${elementSelectorJs}'.`);
  }

  const componentIdJs = platform.toJavaScriptString(componentId);
  componentIdToParentElement[componentIdJs] = element;
}

function renderRenderTree(componentId: System_String, tree: System_Array, treeLength: number) {
  const componentIdJs = platform.toJavaScriptString(componentId);
  const element = componentIdToParentElement[componentIdJs];
  if (!element) {
    throw new Error(`No element is currently associated with component ${componentIdJs}`);
  }

  clearElement(element);
  insertNodeRange(componentIdJs, element, tree, 0, treeLength - 1);
}

function insertNodeRange(componentId: string, intoDomElement: Element, tree: System_Array, startIndex: number, endIndex: number) {
  for (let index = startIndex; index <= endIndex; index++) {
    const node = getTreeNodePtr(tree, index);
    insertNode(componentId, intoDomElement, tree, node, index);

    // Skip over any descendants, since they are already dealt with recursively
    const descendantsEndIndex = renderTreeNode.descendantsEndIndex(node);
    if (descendantsEndIndex > 0) {
      index = descendantsEndIndex;
    }
  }
}

function insertNode(componentId: string, intoDomElement: Element, tree: System_Array, node: RenderTreeNodePointer, nodeIndex: number) {
  const nodeType = renderTreeNode.nodeType(node);
  switch (nodeType) {
    case NodeType.element:
      insertElement(componentId, intoDomElement, tree, node, nodeIndex);
      break;
    case NodeType.text:
      insertText(intoDomElement, node);
      break;
    case NodeType.attribute:
      throw new Error('Attribute nodes should only be present as leading children of element nodes.');
    case NodeType.component:
      insertComponent(intoDomElement, componentId, nodeIndex);
      break;
    default:
      const unknownType: never = nodeType; // Compile-time verification that the switch was exhaustive
      throw new Error(`Unknown node type: ${ unknownType }`);
  }
}

function insertComponent(intoDomElement: Element, parentComponentId: string, componentNodeIndex: number) {
  if (!getComponentRenderInfoMethod) {
    getComponentRenderInfoMethod = platform.findMethod(
      'Microsoft.Blazor.Browser', 'Microsoft.Blazor.Browser', 'DOMComponentRenderState', 'GetComponentRenderInfo'
    );
  }

  // Currently, platform.callMethod always returns a heap object. If the target method
  // tries to return a value, it gets boxed before return.
  const renderInfoBoxed = platform.callMethod(getComponentRenderInfoMethod, null, [
    platform.toDotNetString(parentComponentId),
    platform.toDotNetString(componentNodeIndex.toString())
  ]);
  const renderInfoFields = platform.getHeapObjectFieldsPtr(renderInfoBoxed);
  const componentId = platform.toJavaScriptString(platform.readHeapObject(renderInfoFields, 0) as System_String);
  const componentTree = platform.readHeapObject(renderInfoFields, 4) as System_Array;
  const componentTreeLength = platform.readHeapInt32(renderInfoFields, 8);

  const containerElement = document.createElement('blazor-component');
  intoDomElement.appendChild(containerElement);
  componentIdToParentElement[componentId] = containerElement;
  insertNodeRange(componentId, containerElement, componentTree, 0, componentTreeLength - 1);
}

function insertElement(componentId: string, intoDomElement: Element, tree: System_Array, elementNode: RenderTreeNodePointer, elementNodeIndex: number) {
  const tagName = renderTreeNode.elementName(elementNode);
  const newDomElement = document.createElement(tagName);
  intoDomElement.appendChild(newDomElement);

  // Apply attributes
  const descendantsEndIndex = renderTreeNode.descendantsEndIndex(elementNode);
  for (let descendantIndex = elementNodeIndex + 1; descendantIndex <= descendantsEndIndex; descendantIndex++) {
    const descendantNode = getTreeNodePtr(tree, descendantIndex);
    if (renderTreeNode.nodeType(descendantNode) === NodeType.attribute) {
      applyAttribute(componentId, newDomElement, descendantNode, descendantIndex);
    } else {
      // As soon as we see a non-attribute child, all the subsequent child nodes are
      // not attributes, so bail out and insert the remnants recursively
      insertNodeRange(componentId, newDomElement, tree, descendantIndex, descendantsEndIndex);
      break;
    }
  }
}

function applyAttribute(componentId: string, toDomElement: Element, attributeNode: RenderTreeNodePointer, attributeNodeIndex: number) {
  const attributeName = renderTreeNode.attributeName(attributeNode);

  switch (attributeName) {
    case 'onclick':
      toDomElement.addEventListener('click', () => raiseEvent(componentId, attributeNodeIndex, 'mouse', { Type: 'click' }));
      break;
    case 'onkeypress':
      toDomElement.addEventListener('keypress', evt => {
        // This does not account for special keys nor cross-browser differences. So far it's
        // just to establish that we can pass parameters when raising events.
        // We use C#-style PascalCase on the eventInfo to simplify deserialization, but this could
        // change if we introduced a richer JSON library on the .NET side.
        raiseEvent(componentId, attributeNodeIndex, 'keyboard', { Type: evt.type, Key: (evt as any).key });
      });
      break;
    default:
      // Treat as a regular string-valued attribute
      toDomElement.setAttribute(
        attributeName,
        renderTreeNode.attributeValue(attributeNode)
      );
      break;
  }
}

function raiseEvent(componentId: string, renderTreeNodeIndex: number, eventInfoType: EventInfoType, eventInfo: any) {
  if (!raiseEventMethod) {
    raiseEventMethod = platform.findMethod(
      'Microsoft.Blazor.Browser', 'Microsoft.Blazor.Browser', 'Events', 'RaiseEvent'
    );
  }

  // TODO: Find a way of passing the renderTreeNodeIndex as a System.Int32, possibly boxing
  // it first if necessary. Until then we have to send it as a string.
  platform.callMethod(raiseEventMethod, null, [
    platform.toDotNetString(componentId),
    platform.toDotNetString(renderTreeNodeIndex.toString()),
    platform.toDotNetString(eventInfoType),
    platform.toDotNetString(JSON.stringify(eventInfo))
  ]);
}

function insertText(intoDomElement: Element, textNode: RenderTreeNodePointer) {
  const textContent = renderTreeNode.textContent(textNode);
  const newDomTextNode = document.createTextNode(textContent);
  intoDomElement.appendChild(newDomTextNode);
}

function clearElement(element: Element) {
  let childNode: Node;
  while (childNode = element.firstChild) {
    element.removeChild(childNode);
  }
}

type EventInfoType = 'mouse' | 'keyboard';