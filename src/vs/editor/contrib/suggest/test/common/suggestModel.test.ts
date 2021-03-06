/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import Event from 'vs/base/common/event';
import URI from 'vs/base/common/uri';
import {IDisposable, dispose} from 'vs/base/common/lifecycle';
import {TPromise} from 'vs/base/common/winjs.base';
import {Model} from 'vs/editor/common/model/model';
// import {Handler} from 'vs/editor/common/editorCommon';
// import {Position} from 'vs/editor/common/core/position';
import {ISuggestSupport, ISuggestResult, SuggestRegistry} from 'vs/editor/common/modes';
import {SuggestModel, Context} from 'vs/editor/contrib/suggest/common/suggestModel';
import {Cursor} from 'vs/editor/common/controller/cursor';
import {withMockCodeEditor} from 'vs/editor/test/common/mocks/mockCodeEditor';

suite('SuggestModel - Context', function () {

	let model: Model;

	setup(function () {
		model = Model.createFromString('Das Pferd frisst keinen Gurkensalat - Philipp Reis 1861.\nWer hat\'s erfunden?');
	});

	teardown(function () {
		model.dispose();
	});

	test('Context - shouldAutoTrigger', function () {

		function assertAutoTrigger(offset: number, expected: boolean): void {
			const pos = model.getPositionAt(offset);
			const ctx = new Context(model, pos, false);
			assert.equal(ctx.shouldAutoTrigger(), expected);
		}

		assertAutoTrigger(3, true); // end of word, Das|
		assertAutoTrigger(4, false); // no word Das |
		assertAutoTrigger(1, false); // middle of word D|as
		assertAutoTrigger(55, false); // number, 1861|
	});

	test('Context - isDifferentContext', function () {

		// different line
		const ctx = new Context(model, { lineNumber: 1, column: 8 }, true); // Das Pfer|d
		assert.equal(ctx.isDifferentContext(new Context(model, { lineNumber: 2, column: 1 }, true)), true);


		function createEndContext(value: string) {
			const model = Model.createFromString(value);
			const ctx = new Context(model, model.getPositionAt(value.length), true); // Das Pfer|d
			return ctx;
		}

		// got shorter -> redo
		assert.equal(createEndContext('One Two').isDifferentContext(createEndContext('One Tw')), true);

		// got longer inside word -> keep
		assert.equal(createEndContext('One Tw').isDifferentContext(createEndContext('One Two')), false);

		// got longer new word -> redo
		assert.equal(createEndContext('One Two').isDifferentContext(createEndContext('One Two ')), true);
	});
});

suite('SuggestModel - TriggerAndCancelOracle', function () {


	const alwaysEmptySupport: ISuggestSupport = {
		triggerCharacters: [],
		provideCompletionItems(doc, pos) {
			return <ISuggestResult>{
				currentWord: '',
				incomplete: false,
				suggestions: []
			};
		}
	};

	let disposables: IDisposable[] = [];
	let model: Model;

	setup(function () {
		disposables = dispose(disposables);
		model = Model.createFromString('abc def', undefined, undefined, URI.parse('test:somefile.ttt'));
		disposables.push(model);
	});

	function withOracle(callback: (model: SuggestModel, cursor: Cursor) => any): TPromise<any> {

		let oracle: SuggestModel;
		return new TPromise((resolve, reject) => {
			withMockCodeEditor([], {}, (editor, cursor) => {
				editor.setModel(model);
				oracle = new SuggestModel(editor);
				try {
					resolve(callback(oracle, cursor));
				} catch (err) {
					reject(err);
				}
			});
		}).then(r => {
			oracle.dispose();
			return r;
		});
	}

	function assertEvent<E>(event: Event<E>, action: () => any, assert: (e: E) => any) {
		return new TPromise((resolve, reject) => {
			event(e => {
				try {
					resolve(assert(e));
				} catch (err) {
					reject(err);
				}
			});
			try {
				action();
			} catch (err) {
				reject(err);
			}
		});
	}

	test('events - cancel/trigger', function () {
		return withOracle(model => {

			return TPromise.join([
				assertEvent(model.onDidCancel, function () {
					model.cancel();
				}, function (event) {
					assert.equal(event.retrigger, false);
				}),

				assertEvent(model.onDidCancel, function () {
					model.cancel(true);
				}, function (event) {
					assert.equal(event.retrigger, true);
				}),

				// cancel on trigger
				assertEvent(model.onDidCancel, function () {
					model.trigger(false);
				}, function (event) {
					assert.equal(event.retrigger, false);
				}),

				assertEvent(model.onDidCancel, function () {
					model.trigger(false, true);
				}, function (event) {
					assert.equal(event.retrigger, true);
				}),

				assertEvent(model.onDidTrigger, function () {
					model.trigger(true);
				}, function (event) {
					assert.equal(event.auto, true);
				}),

				assertEvent(model.onDidTrigger, function () {
					model.trigger(false);
				}, function (event) {
					assert.equal(event.auto, false);
				})
			]);
		});
	});


	test('events - suggest/empty', function () {

		disposables.push(SuggestRegistry.register({ scheme: 'test' }, alwaysEmptySupport));

		return withOracle(model => {
			return TPromise.join([
				assertEvent(model.onDidSuggest, function () {
					model.trigger(true);
				}, function (event) {
					assert.equal(event.auto, true);
					assert.equal(event.isFrozen, false);
					assert.equal(event.completionModel.items.length, 0);
				}),
				assertEvent(model.onDidSuggest, function () {
					model.trigger(false);
				}, function (event) {
					assert.equal(event.auto, false);
					assert.equal(event.isFrozen, false);
					assert.equal(event.completionModel.items.length, 0);
				})
			]);
		});
	});

	// test('trigger - on type', function () {

	// 	return withOracle((model, cursor) => {

	// 		cursor.trigger('keyboard', Handler.MoveTo, { position: new Position(1, 4) });

	// 	});

	// });
});