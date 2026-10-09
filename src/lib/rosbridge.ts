export type RosbridgeConnectionState =
  | "DISCONNECTED"
  | "CONNECTING"
  | "CONNECTED"
  | "ERROR";

export interface RosbridgeMessage {
  op: string;
  topic?: string;
  type?: string;
  msg?: Record<string, unknown>;
  id?: string;
  values?: Record<string, unknown>;
  result?: boolean | string;
  [key: string]: unknown;
}

interface SubscriptionOptions {
  topic: string;
  type: string;
  queueLength?: number;
  throttleRate?: number;
}

interface Subscription {
  id: string;
  options: SubscriptionOptions;
  callback: (message: RosbridgeMessage) => void;
}

type ConnectionListener = (
  state: RosbridgeConnectionState,
) => void;

const DEFAULT_URL = "ws://localhost:9090";

export class RosbridgeClient {
  private socket: WebSocket | null = null;

  private url: string;

  private connectionState: RosbridgeConnectionState =
    "DISCONNECTED";

  private readonly subscriptions = new Map<
    string,
    Subscription
  >();

  private readonly pendingServices = new Map<
    string,
    {
      resolve: (value: RosbridgeMessage) => void;
      reject: (reason?: unknown) => void;
    }
  >();

  private listeners = new Set<ConnectionListener>();

  private subscriptionCounter = 0;
  private serviceCounter = 0;

  private reconnectTimer: ReturnType<
    typeof setTimeout
  > | null = null;

  private reconnectDelay = 1000;

  private shouldReconnect = true;

  constructor(url = DEFAULT_URL) {
    this.url = url;
  }

  /* ------------------------------------------------------------------------ */
  /* Connection state                                                        */
  /* ------------------------------------------------------------------------ */

  get state(): RosbridgeConnectionState {
    return this.connectionState;
  }

  isConnected(): boolean {
    return (
      this.socket?.readyState === WebSocket.OPEN
    );
  }

  onConnectionStateChange(
    listener: ConnectionListener,
  ): () => void {
    this.listeners.add(listener);

    listener(this.connectionState);

    return () => {
      this.listeners.delete(listener);
    };
  }

  private setConnectionState(
    state: RosbridgeConnectionState,
  ) {
    this.connectionState = state;

    for (const listener of this.listeners) {
      listener(state);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Connect                                                                 */
  /* ------------------------------------------------------------------------ */

  connect(url = this.url): void {
    if (typeof window === "undefined") {
      return;
    }

    if (
      this.socket &&
      (this.socket.readyState === WebSocket.OPEN ||
        this.socket.readyState === WebSocket.CONNECTING)
    ) {
      return;
    }

    this.shouldReconnect = true;
    this.url = url;

    this.setConnectionState("CONNECTING");

    let socket: WebSocket;

    try {
      socket = new WebSocket(this.url);
    } catch (error) {
      console.error(
        "[ROSBridge] Failed to create WebSocket:",
        error,
      );

      this.setConnectionState("ERROR");

      this.scheduleReconnect();

      return;
    }

    this.socket = socket;

    socket.onopen = () => {
      console.log(
        `[ROSBridge] Connected to ${this.url}`,
      );

      this.reconnectDelay = 1000;

      this.setConnectionState("CONNECTED");

      this.resubscribe();
    };

    socket.onmessage = (event) => {
      this.handleMessage(event.data);
    };

    socket.onerror = (event) => {
      console.error(
        "[ROSBridge] WebSocket error:",
        event,
      );

      this.setConnectionState("ERROR");
    };

    socket.onclose = () => {
      console.warn(
        "[ROSBridge] WebSocket disconnected",
      );

      this.socket = null;

      for (const pending of this.pendingServices.values()) {
        pending.reject(
          new Error(
            "[ROSBridge] Connection closed while waiting for service response",
          ),
        );
      }

      this.pendingServices.clear();

      if (this.shouldReconnect) {
        this.setConnectionState("DISCONNECTED");

        this.scheduleReconnect();
      } else {
        this.setConnectionState("DISCONNECTED");
      }
    };
  }

  /* ------------------------------------------------------------------------ */
  /* Disconnect                                                               */
  /* ------------------------------------------------------------------------ */

  disconnect(): void {
    this.shouldReconnect = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    for (const pending of this.pendingServices.values()) {
      pending.reject(
        new Error(
          "[ROSBridge] Disconnected while waiting for service response",
        ),
      );
    }

    this.pendingServices.clear();

    this.setConnectionState("DISCONNECTED");
  }

  /* ------------------------------------------------------------------------ */
  /* Reconnect                                                                */
  /* ------------------------------------------------------------------------ */

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) {
      return;
    }

    if (this.reconnectTimer) {
      return;
    }

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;

      this.connect();

      this.reconnectDelay = Math.min(
        this.reconnectDelay * 2,
        10000,
      );
    }, this.reconnectDelay);
  }

  /* ------------------------------------------------------------------------ */
  /* Subscribe                                                                */
  /* ------------------------------------------------------------------------ */

  subscribe(
    options: SubscriptionOptions,
    callback: (message: RosbridgeMessage) => void,
  ): () => void {
    const id = `sub_${++this.subscriptionCounter}`;

    const subscription: Subscription = {
      id,
      options,
      callback,
    };

    this.subscriptions.set(id, subscription);

    if (
      this.socket?.readyState === WebSocket.OPEN
    ) {
      this.sendSubscribe(subscription);
    }

    return () => {
      this.unsubscribe(id);
    };
  }

  private sendSubscribe(
    subscription: Subscription,
  ): void {
    const {
      topic,
      type,
      queueLength,
      throttleRate,
    } = subscription.options;

    this.send({
      op: "subscribe",
      id: subscription.id,
      topic,
      type,
      ...(queueLength !== undefined
        ? { queue_length: queueLength }
        : {}),
      ...(throttleRate !== undefined
        ? { throttle_rate: throttleRate }
        : {}),
    });
  }

  private unsubscribe(id: string): void {
    const subscription =
      this.subscriptions.get(id);

    if (!subscription) {
      return;
    }

    if (
      this.socket?.readyState === WebSocket.OPEN
    ) {
      this.send({
        op: "unsubscribe",
        id,
        topic: subscription.options.topic,
      });
    }

    this.subscriptions.delete(id);
  }

  private resubscribe(): void {
    for (const subscription of this.subscriptions.values()) {
      this.sendSubscribe(subscription);
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Publish                                                                  */
  /* ------------------------------------------------------------------------ */

  publish<T>(
    topic: string,
    type: string,
    message: T,
  ): boolean {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return false;
    }

    this.send({
      op: "publish",
      topic,
      type,
      msg: message as unknown as Record<string, unknown>,
    });

    return true;
  }

  /* ------------------------------------------------------------------------ */
  /* Service calls                                                            */
  /* ------------------------------------------------------------------------ */

  callService(
    service: string,
    args: Record<string, unknown> = {},
  ): Promise<RosbridgeMessage> {
    return new Promise((resolve, reject) => {
      if (
        !this.socket ||
        this.socket.readyState !== WebSocket.OPEN
      ) {
        reject(
          new Error(
            "[ROSBridge] Cannot call service while disconnected",
          ),
        );
        return;
      }

      const id =
        `srv_${++this.serviceCounter}`;

      this.pendingServices.set(id, {
        resolve,
        reject,
      });

      this.send({
        op: "call_service",
        id,
        service,
        args,
      });
    });
  }

  /* ------------------------------------------------------------------------ */
  /* Incoming messages                                                        */
  /* ------------------------------------------------------------------------ */

  private handleMessage(raw: unknown): void {
    if (typeof raw !== "string") {
      console.warn(
        "[ROSBridge] Ignoring non-text message",
      );

      return;
    }

    let message: RosbridgeMessage;

    try {
      message = JSON.parse(raw) as RosbridgeMessage;
    } catch (error) {
      console.error(
        "[ROSBridge] Invalid JSON message:",
        error,
      );

      return;
    }

    if (message.op === "service_response") {
      if (!message.id) {
        return;
      }

      const pending =
        this.pendingServices.get(message.id);

      if (!pending) {
        return;
      }

      this.pendingServices.delete(message.id);

      pending.resolve(message);

      return;
    }

    if (message.op !== "publish") {
      return;
    }

    if (!message.topic) {
      return;
    }

    for (const subscription of this.subscriptions.values()) {
      if (
        subscription.options.topic ===
        message.topic
      ) {
        try {
          subscription.callback(message);
        } catch (error) {
          console.error(
            `[ROSBridge] Subscription callback failed for ${message.topic}:`,
            error,
          );
        }
      }
    }
  }

  /* ------------------------------------------------------------------------ */
  /* Send                                                                     */
  /* ------------------------------------------------------------------------ */

  private send(message: Record<string, unknown>): void {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN
    ) {
      return;
    }

    try {
      this.socket.send(JSON.stringify(message));
    } catch (error) {
      console.error(
        "[ROSBridge] Failed to send message:",
        error,
      );
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Singleton                                                                  */
/* -------------------------------------------------------------------------- */

let rosbridgeClient: RosbridgeClient | null = null;

export function getRosbridgeClient(): RosbridgeClient {
  if (!rosbridgeClient) {
    rosbridgeClient = new RosbridgeClient(
      DEFAULT_URL,
    );
  }

  return rosbridgeClient;
}

const rosbridge = getRosbridgeClient();

export default rosbridge;
