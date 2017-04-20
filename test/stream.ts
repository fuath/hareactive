import {ProducerBehavior} from "../src";
import { Behavior, fromFunction } from "../src/behavior";
import { State } from "../src/common";
import { assert } from "chai";
import { spy, useFakeTimers } from "sinon";

import { map, publish } from "../src/index";
import {
  empty, isStream, ProducerStream, sinkStream, snapshot, snapshotWith,
  Stream, subscribe, testStreamFromArray, testStreamFromObject
} from "../src/stream";
import {} from "../src/behavior";

const addTwo = (v: number): number => v + 2;
const sum = (a: number, b: number): number => a + b;

class TestProducer<A> extends ProducerStream<A> {
  constructor(
    private activateSpy: sinon.SinonSpy,
    private deactivateSpy: sinon.SinonSpy
  ) {
    super();
  }
  activate(): void {
    this.activateSpy();
    this.state = State.Pull;
  }
  deactivate(): void {
    this.deactivateSpy();
  }
}

function createTestProducer() {
  const activate = spy();
  const deactivate = spy();
  const producer = new TestProducer(activate, deactivate);
  const push = producer.push.bind(producer);
  return {activate, deactivate, push, producer};
}

class TestProducerBehavior<A> extends ProducerBehavior<A> {
  constructor(
    public last: A,
    private activateSpy: sinon.SinonSpy,
    private deactivateSpy: sinon.SinonSpy
  ) {
    super();
  }
  activate(): void {
    this.activateSpy();
    this.state = State.Pull;
  }
  deactivate(): void {
    this.deactivateSpy();
  }
}

function createTestProducerBehavior<A>(initial: A) {
  const activate = spy();
  const deactivate = spy();
  const producer = new TestProducerBehavior(initial, activate, deactivate);
  const push = producer.push.bind(producer);
  return {activate, deactivate, push, producer};
}

describe("stream", () => {
  describe("test streams", () => {
    it("creates test stream with increasing times from array", () => {
      const s = testStreamFromArray([0, 1, 2, 3]);
      assert.deepEqual(s.semantic(), [
        { value: 0, time: 0 },
        { value: 1, time: 1 },
        { value: 2, time: 2 },
        { value: 3, time: 3 }
      ]);
    });
    it("creates test stream from object", () => {
      const s = testStreamFromObject({
        2: "one",
        4: "two",
        5.5: "three"
      });
      assert.deepEqual(s.semantic(), [
        { value: "one", time: 2 },
        { value: "two", time: 4 },
        { value: "three", time: 5.5 }
      ]);
    });
  });
  describe("isStream", () => {
    it("should be true when Stream object", () => {
      assert.isTrue(isStream(empty));
    });
    /*
    it("should be true on placeholder", () => {
      assert.isTrue(isStream(placeholder())); 
    });
    */
    it("should be false when not Stream object", () => {
      assert.isFalse(isStream([]));
      assert.isFalse(isStream({}));
      assert.isFalse(isStream("test"));
      assert.isFalse(isStream([empty]));
      assert.isFalse(isStream(1234));
      assert.isFalse(isStream(isStream));
    });
  });
  describe("subscribe", () => {
    it("supports multiple listeners", () => {
      const s = sinkStream();
      const cb1 = spy();
      const cb2 = spy();
      s.subscribe(cb1);
      s.subscribe(cb2);
      publish(2, s);
      publish(3, s);
      assert.strictEqual(cb1.callCount, 2);
      assert.strictEqual(cb2.callCount, 2);
    });
    it("single listeners can be removed", () => {
      const s = sinkStream();
      const cb1 = spy();
      const cb2 = spy();
      s.subscribe(cb1);
      const listener = s.subscribe(cb2);
      s.removeListener(listener);
      publish(2, s);
      publish(3, s);
      assert.strictEqual(cb1.callCount, 2);
      assert.strictEqual(cb2.callCount, 0);
    });
    it("supports removing listener when more than two", () => {
      const s = sinkStream();
      const cb1 = spy();
      const cb2 = spy();
      const cb3 = spy();
      s.subscribe(cb1);
      const listener = s.subscribe(cb2);
      s.subscribe(cb3);
      s.removeListener(listener);
      publish(2, s);
      publish(3, s);
      assert.strictEqual(cb1.callCount, 2);
      assert.strictEqual(cb2.callCount, 0);
      assert.strictEqual(cb3.callCount, 2);
    });
  });
  describe("producer", () => {
    it("activates and deactivates", () => {
      const activate = spy();
      const deactivate = spy();
      class MyProducer<A> extends ProducerStream<A> {
        activate(): void {
          activate();
          this.state = State.Pull;
        }
        deactivate(): void {
          deactivate();
        }
      }
      const producer = new MyProducer();
      const observer = producer.subscribe((a) => a);
      observer.deactivate();
      assert(activate.calledOnce);
      assert(deactivate.calledOnce);
    });
    it("pushes to listener", () => {
      const callback = spy();
      let push: (n: number) => void;
      class MyProducer<A> extends ProducerStream<A> {
        activate(): void {
          push = this.push.bind(this);
        }
        deactivate(): void {
          push = undefined;
        }
      }
      const producer = new MyProducer();
      producer.subscribe(callback);
      push(1);
      push(2);
      assert.deepEqual(callback.args, [[1], [2]]);
    });
  });
  describe("empty", () => {
    it("is empty array semantically", () => {
      assert.deepEqual(empty.semantic(), []);
    });
  });
  describe("combine", () => {
    describe("semantics", () => {
      it("interleaves occurrences", () => {
        const s1 = testStreamFromObject({
          0: "first",
          2: "third",
          4: "fifth"
        });
        const s2 = testStreamFromObject({
          1: "second",
          3: "fourth"
        });
        const combined = s1.combine(s2);
        assert.deepEqual(
          combined.semantic(),
          testStreamFromArray(["first", "second", "third", "fourth", "fifth"]).semantic()
        );
      });
    });
    it("should combine two streams", () => {
      const stream1 = sinkStream();
      const stream2 = sinkStream();
      const callback = spy();
      const combinedS = stream2.combine(stream1);
      combinedS.subscribe(callback);
      publish(1, stream1);
      publish("2", stream2);
      assert.deepEqual(callback.args, [[1], ["2"]]);
    });
  });
  describe("map", () => {
    it("maps values semantically", () => {
      const s = testStreamFromArray([1, 2, 3]);
      const mapped = s.map((n) => n * n);
      assert.deepEqual(
        mapped.semantic(),
        testStreamFromArray([1, 4, 9]).semantic()
      );
    });
    it("should map the published values", () => {
      const obs = sinkStream();
      const callback = spy();
      const mappedObs = map(addTwo, obs);
      subscribe(callback, mappedObs);
      for (let i = 0; i < 5; i++) {
        publish(i, obs);
      }
      assert.deepEqual(callback.args, [[2], [3], [4], [5], [6]]);
    });
    it("maps to a constant with mapTo", () => {
      const stream = sinkStream();
      const callback = spy();
      const mapped = stream.mapTo(7);
      subscribe(callback, mapped);
      publish(1, stream);
      publish(2, stream);
      publish(3, stream);
      assert.deepEqual(callback.args, [[7], [7], [7]]);
    });
    it("maps to constant semantically", () => {
      const s = testStreamFromArray([1, 2, 3]);
      const mapped = s.mapTo(7);
      assert.deepEqual(
        mapped.semantic(),
        testStreamFromArray([7, 7, 7]).semantic()
      );
    });
    /*
    it("works on placeholder", () => {
      let result = 0;
      const p = placeholder();
      const mapped = p.map((s: number) => s + 1);
      mapped.subscribe((n: number) => result = n);
      const s = S.empty();
      p.replaceWith(s);
      assert.strictEqual(result, 0);
      s.push(1)
      assert.strictEqual(result, 2);
    });
    */
  });
  describe("snapshot", () => {
    it("snapshots pull based Behavior", () => {
      let n = 0;
      const b: Behavior<number> = fromFunction(() => n);
      const e = sinkStream<number>();
      const shot = snapshot<number>(b, e);
      const callback = spy();
      subscribe(callback, shot);
      publish(0, e);
      publish(1, e);
      n = 1;
      publish(2, e);
      n = 2;
      publish(3, e);
      publish(4, e);
      assert.deepEqual(callback.args, [
        [0], [0], [1], [2], [2]
      ]);
    });
    it("activates producer", () => {
      const {activate, push, producer} = createTestProducerBehavior(0);
      const mapped = map(addTwo, producer);
      const s = sinkStream<undefined>();
      const shot = snapshot(mapped, s);
      const callback = spy();
      shot.subscribe(callback);
      s.push(undefined);
      push(1);
      s.push(undefined);
      push(2);
      s.push(undefined);
      push(3);
      push(4);
      s.push(undefined);
      assert(activate.calledOnce, "called once");
      assert.deepEqual(callback.args, [
        [2], [3], [4], [6]
      ]);
    });
    it("applies function in snapshotWith to pull based Behavior", () => {
      let n = 0;
      const b: Behavior<number> = fromFunction(() => n);
      const e = sinkStream<number>();
      const shot = snapshotWith<number, number, number>(sum, b, e);
      const callback = spy();
      subscribe(callback, shot);
      publish(0, e);
      publish(1, e);
      n = 1;
      publish(2, e);
      n = 2;
      publish(3, e);
      publish(4, e);
      assert.deepEqual(callback.args, [
        [0], [1], [3], [5], [6]
      ]);
    });
    /*
    it("works with placeholder", () => {
      let result = 0;
      const b = Behavior.of(7);
      const p = placeholder();
      const snap = snapshot(b, p);
      snap.subscribe((n: number) => result = n);
      const s = S.empty();
      p.replaceWith(s);
      assert.strictEqual(result, 0);
      s.push(1);
      assert.strictEqual(result, 7);
    });
    */
  });
});
