/**
 * Copyright (c) 2013-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule DraftEditorBlock.react
 * @format
 * @flow
 */

'use strict';

import type {BlockNodeRecord} from 'BlockNodeRecord';
import type ContentState from 'ContentState';
import type {DraftDecoratorType} from 'DraftDecoratorType';
import type {DraftInlineStyle} from 'DraftInlineStyle';
import type SelectionState from 'SelectionState';
import type {BidiDirection} from 'UnicodeBidiDirection';
import type {List} from 'immutable';

const DraftEditorLeaf = require('DraftEditorLeaf.react');
const DraftOffsetKey = require('DraftOffsetKey');
const React = require('React');
const ReactDOM = require('ReactDOM');
const Scroll = require('Scroll');
const Style = require('Style');
const UnicodeBidi = require('UnicodeBidi');
const UnicodeBidiDirection = require('UnicodeBidiDirection');

const cx = require('cx');
const getElementPosition = require('getElementPosition');
const getScrollPosition = require('getScrollPosition');
const getViewportDimensions = require('getViewportDimensions');
const invariant = require('invariant');
const nullthrows = require('nullthrows');

const SCROLL_BUFFER = 10;

type Props = {
  block: BlockNodeRecord,
  blockProps?: Object,
  blockStyleFn: (block: BlockNodeRecord) => string,
  contentState: ContentState,
  customStyleFn: (style: DraftInlineStyle, block: BlockNodeRecord) => ?Object,
  customStyleMap: Object,
  decorator: ?DraftDecoratorType,
  direction: BidiDirection,
  forceSelection: boolean,
  offsetKey: string,
  selection: SelectionState,
  startIndent?: boolean,
  tree: List<any>,
};

/**
 * Return whether a block overlaps with either edge of the `SelectionState`.
 */
const isBlockOnSelectionEdge = (
  selection: SelectionState,
  key: string,
): boolean => {
  return selection.getAnchorKey() === key || selection.getFocusKey() === key;
};

/**
 * The default block renderer for a `DraftEditor` component.
 *
 * A `DraftEditorBlock` is able to render a given `ContentBlock` to its
 * appropriate decorator and inline style components.
 */
class DraftEditorBlock extends React.Component<Props> {
  shouldComponentUpdate(nextProps: Props): boolean {
    return (
      this.props.block !== nextProps.block ||
      this.props.tree !== nextProps.tree ||
      this.props.direction !== nextProps.direction ||
      (isBlockOnSelectionEdge(nextProps.selection, nextProps.block.getKey()) &&
        nextProps.forceSelection)
    );
  }

  /**
   * When a block is mounted and overlaps the selection state, we need to make
   * sure that the cursor is visible to match native behavior. This may not
   * be the case if the user has pressed `RETURN` or pasted some content, since
   * programatically creating these new blocks and setting the DOM selection
   * will miss out on the browser natively scrolling to that position.
   *
   * To replicate native behavior, if the block overlaps the selection state
   * on mount, force the scroll position. Check the scroll state of the scroll
   * parent, and adjust it to align the entire block to the bottom of the
   * scroll parent.
   */
  componentDidMount(): void {
    const selection = this.props.selection;
    const endKey = selection.getEndKey();
    if (!selection.getHasFocus() || endKey !== this.props.block.getKey()) {
      return;
    }

    const blockNode = ReactDOM.findDOMNode(this);
    const scrollParent = Style.getScrollParent(blockNode);
    const scrollPosition = getScrollPosition(scrollParent);
    let scrollDelta;

    if (scrollParent === window) {
      const nodePosition = getElementPosition(blockNode);
      const nodeBottom = nodePosition.y + nodePosition.height;
      const viewportHeight = getViewportDimensions().height;
      scrollDelta = nodeBottom - viewportHeight;
      if (scrollDelta > 0) {
        window.scrollTo(
          scrollPosition.x,
          scrollPosition.y + scrollDelta + SCROLL_BUFFER,
        );
      }
    } else {
      invariant(
        blockNode instanceof HTMLElement,
        'blockNode is not an HTMLElement',
      );
      const blockBottom = blockNode.offsetHeight + blockNode.offsetTop;
      const scrollBottom = scrollParent.offsetHeight + scrollPosition.y;
      scrollDelta = blockBottom - scrollBottom;
      if (scrollDelta > 0) {
        Scroll.setTop(
          scrollParent,
          Scroll.getTop(scrollParent) + scrollDelta + SCROLL_BUFFER,
        );
      }
    }
  }

  _renderChildren(): Array<React.Element<any>> {
    const block = this.props.block;
    const blockKey = block.getKey();
    const text = block.getText();
    const lastLeafSet = this.props.tree.size - 1;
    const hasSelection = isBlockOnSelectionEdge(this.props.selection, blockKey);

    return this.props.tree
      .map((leafSet, ii) => {
        const leavesForLeafSet = leafSet.get('leaves');
        const lastLeaf = leavesForLeafSet.size - 1;
        const leaves = leavesForLeafSet
          .map((leaf, jj) => {
            const offsetKey = DraftOffsetKey.encode(blockKey, ii, jj);
            const start = leaf.get('start');
            const end = leaf.get('end');
            return (
              <DraftEditorLeaf
                key={offsetKey}
                offsetKey={offsetKey}
                block={block}
                start={start}
                selection={hasSelection ? this.props.selection : null}
                forceSelection={this.props.forceSelection}
                text={text.slice(start, end)}
                styleSet={block.getInlineStyleAt(start)}
                customStyleMap={this.props.customStyleMap}
                customStyleFn={this.props.customStyleFn}
                isLast={ii === lastLeafSet && jj === lastLeaf}
              />
            );
          })
          .toArray();

        const decoratorKey = leafSet.get('decoratorKey');
        if (decoratorKey == null) {
          return leaves;
        }

        if (!this.props.decorator) {
          return leaves;
        }

        const decorator = nullthrows(this.props.decorator);

        const DecoratorComponent = decorator.getComponentForKey(decoratorKey);
        if (!DecoratorComponent) {
          return leaves;
        }

        const decoratorProps = decorator.getPropsForKey(decoratorKey);
        const decoratorOffsetKey = DraftOffsetKey.encode(blockKey, ii, 0);
        const decoratedText = text.slice(
          leavesForLeafSet.first().get('start'),
          leavesForLeafSet.last().get('end'),
        );

        // Resetting dir to the same value on a child node makes Chrome/Firefox
        // confused on cursor movement. See http://jsfiddle.net/d157kLck/3/
        const dir = UnicodeBidiDirection.getHTMLDirIfDifferent(
          UnicodeBidi.getDirection(decoratedText),
          this.props.direction,
        );

        return (
          <DecoratorComponent
            {...decoratorProps}
            contentState={this.props.contentState}
            decoratedText={decoratedText}
            dir={dir}
            key={decoratorOffsetKey}
            entityKey={block.getEntityAt(leafSet.get('start'))}
            offsetKey={decoratorOffsetKey}>
            {leaves}
          </DecoratorComponent>
        );
      })
      .toArray();
  }

  render(): React.Node {
    const {direction, offsetKey} = this.props;
    const className = cx({
      'public/DraftStyleDefault/block': true,
      'public/DraftStyleDefault/ltr': direction === 'LTR',
      'public/DraftStyleDefault/rtl': direction === 'RTL',
    });

    return (
      <div data-offset-key={offsetKey} className={className}>
        {this._renderChildren()}
      </div>
    );
  }
}

module.exports = DraftEditorBlock;
