import {
  View,
  Text,
  Image,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  LayoutAnimation,
} from "react-native";
import React, { useState } from "react";
import ReceiptFull from "./ReceiptFull";
import { extractReceiptData } from "../lib/extractReceiptData";
import images from "../constants/images";
import {
  projectId,
  createReceipt,
  getCurrentUser,
  uploadReceiptImage,
  isDuplicateReceipt,
  createNotification,
  countUnreadNotifications,
} from "../lib/appwrite";
import Checkbox from "expo-checkbox"; // Make sure expo-checkbox is installed
import { useGlobalContext } from "../context/GlobalProvider";
import { router } from "expo-router";
import * as FileSystem from "expo-file-system"; // for reading the image as blob
import mime from "mime"; // helps get MIME type from file extension

const ReceiptProcess = ({ imageUri, onCancel, onRefresh }) => {
  const [showFullImage, setShowFullImage] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");
  const [extractedData, setExtractedData] = useState(null);
  const [consentGiven, setConsentGiven] = useState(false);
  const [collapsed, setCollapsed] = useState(true);
  const { user, updateUnreadCount } = useGlobalContext();

  const toggleCollapsed = () => {
    setCollapsed(!collapsed);
  };
  const [showAllItems, setShowAllItems] = useState(false);

  const toggleItems = () => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setShowAllItems((prev) => !prev);
  };
  const handleProcessReceipt = async () => {
    try {
      setIsProcessing(true);
      const data = await extractReceiptData(imageUri);

      // Check if it's not a receipt
      if (!data.isReceipt) {
        Alert.alert(
          "Not a Receipt",
          data.message || "This image is not a receipt."
        );
        return;
      }

      // Set the extracted data if it is a receipt
      setExtractedData(data.data); // access the inner `data` field
      Alert.alert("Success", "Receipt processed successfully!");
    } catch (error) {
      Alert.alert("Error", "Failed to extract receipt data.");
      console.error("Receipt extraction failed:", error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleSave = async () => {
    if (!consentGiven) {
      Alert.alert(
        "Consent Required",
        "Please agree to save your data before proceeding."
      );
      return;
    }

    if (!extractedData || !imageUri || !user) {
      Alert.alert("Error", "Missing receipt data or image.");
      return;
    }

    const isDuplicate = await isDuplicateReceipt(
      user.$id,
      extractedData.merchant || "Unknown",
      extractedData.datetime || new Date().toISOString(),
      extractedData.total || 0
    );

    if (isDuplicate) {
      Alert.alert(
        "Duplicate Receipt",
        "This receipt already exists and won't be saved again."
      );
      return;
    }

    try {
      setIsProcessing(true);

      const fileInfo = await FileSystem.getInfoAsync(imageUri);
      const fileUri = fileInfo.uri;
      const fileName = fileUri.split("/").pop();
      const mimeType = mime.getType(fileName); // e.g., "image/jpeg"

      const uploadedFile = await uploadReceiptImage(
        fileUri,
        fileName,
        mimeType
      );

      // Prepare receipt data with storage reference
      let isoDatetime;
      if (extractedData.datetime) {
        const parsedDate = new Date(extractedData.datetime);
        isoDatetime = isNaN(parsedDate)
          ? new Date().toISOString()
          : parsedDate.toISOString();
      } else {
        isoDatetime = new Date().toISOString();
      }

      const receiptData = {
        user_id: user.$id,
        merchant: extractedData.merchant || "Unknown",
        location: extractedData.location || "Unknown",
        datetime: isoDatetime,
        currency: "EGP",
        subtotal: parseFloat(extractedData.subtotal) || 0,
        vat: parseFloat(extractedData.vat) || 0,
        total: parseFloat(extractedData.total) || 0,
        items: JSON.stringify(extractedData.items || []),
        image_file_id: uploadedFile.$id,
        image_type: uploadedFile.mimeType,
        image_size: uploadedFile.sizeOriginal || 0,
        image_url: `https://cloud.appwrite.io/v1/storage/buckets/${uploadedFile.bucketId}/files/${uploadedFile.$id}/view?project=${projectId}`,
      };
      // Save receipt metadata in the database
      const response = await createReceipt(receiptData);

      if (response && response.$id) {
        Alert.alert("Success", "Receipt saved successfully!");

        // Create notification
        await createNotification({
          user_id: user.$id,
          title: "Receipt Uploaded",
          message: "Your receipt was successfully uploaded.",
          receipt_id: response.$id, // ✅ Link the notification to the uploaded receipt
        });
        // Update the unread notification count in the context
        const updatedUnreadCount = await countUnreadNotifications(user.$id); // Fetch updated unread count
        updateUnreadCount(updatedUnreadCount); // Update context with new unread count

        onRefresh();
        onCancel(); // Close the modal
      } else {
        console.error("Invalid response from createReceipt:", response);
        Alert.alert("Error", "Receipt was not saved. Please try again.");
      }
    } catch (error) {
      console.error("Save error:", error);
      Alert.alert("Error", "Could not save receipt.");
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <View className="bg-orange-50 rounded-3xl px-2 pt-2 pb-1   max-h-[90vh] ">
      <ScrollView
        contentContainerStyle={{
          alignItems: "center",
          paddingBottom: 1,
          flexGrow: 1,
        }}
        showsVerticalScrollIndicator={true}
        // style={{ borderColor: 'red', borderWidth: 1 }}
      >
        {extractedData && (
          <>
            <Image
              source={images.success}
              className="  w-16 h-16  right-1"
              resizeMode="contain"
            />
            <Text className="text-xl text-blue-900 font-pbold text-center mb-2">
              {!extractedData
                ? "Receipt Processing..."
                : "🎉 Receipt Extracted Successfuly"}
            </Text>
          </>
        )}

        {!extractedData && (
          <TouchableOpacity
            onPress={() => setShowFullImage(true)}
            className="relative w-full"
          >
            <Image
              source={{ uri: imageUri }}
              resizeMode="contain"
              className="w-full aspect-[5/6] mb-1 mt-4 rounded-3xl"
            />
            <View className="absolute bottom-36 right-2 bg-black/70 px-2 py-1 rounded">
              <Text className="font-psemibold text-base text-white">
                Tap to view full
              </Text>
            </View>
          </TouchableOpacity>
        )}

        {!extractedData && (
          <>
            {isProcessing ? (
              <View className="items-center mt-6 mb-6">
                <ActivityIndicator size="large" color="#ef6969" />
                <Text className="mt-2 font-psemibold text-black/70">
                  {`Processing...\n Our platform uses advanced AI to automatically extract key details from your uploaded receipt.`}
                </Text>
              </View>
            ) : (
              <View className="flex-row justify-center items-center gap-6 mt-4 mb-6">
                <TouchableOpacity onPress={onCancel}>
                  <View className="items-center">
                    <Image
                      source={images.cancel}
                      resizeMode="contain"
                      className="w-[50px] h-[50px] rounded-full p-1 border-2 border-red-400 opacity-90"
                    />
                    <Text className="mt-1 font-pregular text-sm text-black/80">
                      Cancel
                    </Text>
                  </View>
                </TouchableOpacity>

                <TouchableOpacity onPress={handleProcessReceipt}>
                  <View className="items-center">
                    <Image
                      source={images.confirm}
                      resizeMode="contain"
                      className="w-[50px] h-[50px] rounded-full p-1 border-2 border-green-500 opacity-90"
                    />
                    <Text className="mt-1 font-pregular text-sm text-black/80">
                      Process
                    </Text>
                  </View>
                </TouchableOpacity>
              </View>
            )}
          </>
        )}

        {extractedData && (
          <>
            <View className="w-full  mt-1 px-8 py-1 bg-slate-200  rounded-xl border-2 border-[#b94040]  mb-2">
              <Text className="font-plight text-lg mb-4 text-red-900 text-center underline">
                Receipt Details
              </Text>

              {extractedData.merchant && !showAllItems && (
                <Text className="text-blue-900 font-psemibold mb-3 text-base">
                  <Text className="text-black font-semibold text-base ">
                    🏪 Merchant →
                  </Text>{" "}
                  {extractedData.merchant}
                </Text>
              )}

              {extractedData.location && !showAllItems && (
                <Text className="text-blue-900 font-psemibold mb-3 text-base">
                  <Text className="text-black font-pbold text-base">
                    📍 Location →
                  </Text>{" "}
                  {extractedData.location}
                </Text>
              )}

              {extractedData.datetime && !showAllItems && (
                <Text className="text-blue-900 font-psemibold mb-3 text-base">
                  <Text className="text-black font-pbold text-base">
                    📅 Date →
                  </Text>{" "}
                  {extractedData.datetime}
                </Text>
              )}

              {extractedData.items.length > 0 && !showAllItems && (
                <View>
                  <Text className="font-pbold text-base text-black mb-1 ">
                    🗂️ Category:
                  </Text>
                  <Text className="text-base text-green-900 ml-4 mb-2 font-psemibold">
                    {extractedData.items[0].category || "Unknown"} →{" "}
                    {extractedData.items[0].subcategory || "Uncategorized"}
                  </Text>
                </View>
              )}

              {/* Items extracted as collapssed */}

              {extractedData.items?.length > 0 && (
                <View className="mb-3">
                  {/* Always show the "Items" label */}
                  <View className="flex-row items-center mb-1">
                    <Text className="font-pbold text-base text-blue-700">
                      🛒 Items:
                    </Text>
                    {extractedData.items.length > 3 && (
                      <TouchableOpacity onPress={toggleItems}>
                        <Text className="font-pbold text-base text-blue-700 ml-1">
                          {showAllItems ? "(▲ Show less)" : "(Show more ▼)"}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>

                  {(showAllItems || extractedData.items.length <= 2
                    ? extractedData.items
                    : extractedData.items.slice(0, 2)
                  ).map((item, index) => (
                    <View key={index} className="ml-4 mb-1 p-1   ">
                      <Text className="text-blue-900 font-psemibold text-base">
                        • {item.name || "Unnamed item"} →{" "}
                        <Text className="font-bold text-red-900 text-base">
                          {item.price || "N/A"}
                        </Text>
                      </Text>
                    </View>
                  ))}

                  {/* Show toggle only if more than 3 items */}
                  {extractedData.items.length > 3 && (
                    <TouchableOpacity onPress={toggleItems}>
                      <Text className="text-blue-700 font-pbold ml-4 mt-1 text-base">
                        {showAllItems
                          ? "▲ Hide Items & Show Details"
                          : "▼ Show All Items"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
              )}

              {extractedData.subtotal && !showAllItems && (
                <Text className="text-red-900  text-base font-psemibold mb-1">
                  <Text className="text-black font-pbold text-base">
                    💵 Subtotal →
                  </Text>{" "}
                  {extractedData.subtotal}
                </Text>
              )}
              {extractedData.vat && !showAllItems && (
                <Text className="text-red-900  text-base font-psemibold mb-1">
                  <Text className="text-black font-pbold text-base">
                    🧾 VAT →
                  </Text>{" "}
                  {extractedData.vat}
                </Text>
              )}
            </View>
            {extractedData.total && (
              <Text className="text-blue-900 font-psemibold mb-1 text-xl">
                <Text className="text-black font-pbold text-xl">💰 Total:</Text>{" "}
                {extractedData.total}
              </Text>
            )}

            {/* Consent checkbox */}
            <View className="flex-row items-center mt-4 gap-2 px-4">
              <Checkbox
                value={consentGiven}
                onValueChange={setConsentGiven}
                color={consentGiven ? "#22c55e" : undefined}
              />
              <Text className="text-base text-black/90 font-pregular ">
                Your data is saved securely and may be shared anonymized with
                trusted third parties..
              </Text>
            </View>

            {/* Buttons */}
            <View className="flex-row justify-center items-center gap-6 mt-0 mb-1">
              <TouchableOpacity onPress={onCancel}>
                <View className="items-center">
                  <Image
                    source={images.cancel}
                    resizeMode="contain"
                    className="w-[55px] h-[55px] rounded-full p-1 border-2 border-red-400 opacity-90"
                  />
                  <Text className="mt-1 font-pregular text-sm text-black/80">
                    Cancel
                  </Text>
                </View>
              </TouchableOpacity>

              <TouchableOpacity onPress={handleSave}>
                <View className="items-center opacity-100">
                  <Image
                    source={images.confirm}
                    resizeMode="contain"
                    className={`w-[58px] h-[58px] rounded-full p-1 border-2 ${
                      consentGiven ? "border-green-500" : "border-gray-300"
                    }`}
                  />
                  <Text className="mt-1 font-pregular text-sm text-black/80">
                    Save
                  </Text>
                </View>
              </TouchableOpacity>
            </View>
          </>
        )}

        {extractedData && isProcessing && (
          <View className="items-center mt-4 mb-6 px-4">
            <ActivityIndicator size="large" color="#ef6969" />
            <Text className="text-center mt-2 text-black/70 font-pregular">
              Your data is saved securely and may be shared with trusted third
              parties.
            </Text>
            {/* <Text className="text-center text-black/70 font-pregular">
              We value your trust. All shared data is anonymized and requires
              your consent.
            </Text> */}
          </View>
        )}
      </ScrollView>

      <ReceiptFull
        imageUri={imageUri}
        visible={showFullImage}
        onClose={() => setShowFullImage(false)}
      />
    </View>
  );
};

export default ReceiptProcess;
